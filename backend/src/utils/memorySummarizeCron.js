/**
 * @fileoverview 30-minute all-agents memory summarizer.
 * Purpose: When an agent has new dayLogs / short notes / curated / Mem0 / chat since the
 * last pass, LLM-compress those into a clean day summary + curated list + episodic note.
 * Downstream: startAgentScheduler in scheduler.js; Agent.memoryContentChangedAt markers.
 */

import { Agent, utcDayKey } from "../models/Agent.js";
import { User } from "../models/User.js";
import { llmChatCompletion } from "./llmChat.js";
import { resolveLlmCredentialsForAgent } from "./llmCredentials.js";
import {
  normalizeEntries,
  findNearDuplicateIndex,
  normalizeFactKey,
} from "./curatedMemory.js";
import {
  mem0ListFacts,
  mem0AddFact,
  mem0DeleteByContent,
} from "./mem0Service.js";
import {
  isEphemeralListResult,
  looksLikeListDumpBody,
} from "./curatedMemoryFilter.js";

/** How often the global tick runs. */
export const MEMORY_SUMMARIZE_INTERVAL_MS = 30 * 60 * 1000;

/** Max agents processed per tick (all agents are scanned; only dirty ones run). */
const MAX_AGENTS_PER_TICK = 12;

/**
 * Agents with new content since last summarize (or never summarized).
 * @returns {Promise<import('mongoose').Document[]>}
 */
async function findAgentsNeedingMemorySummarize() {
  return Agent.find({
    deletedAt: null,
    active: { $ne: false },
    memoryContentChangedAt: { $ne: null },
    $or: [
      { lastMemorySummarizeAt: null },
      {
        $expr: {
          $gt: ["$memoryContentChangedAt", "$lastMemorySummarizeAt"],
        },
      },
    ],
  })
    .sort({ memoryContentChangedAt: -1 })
    .limit(MAX_AGENTS_PER_TICK);
}

/**
 * Build compact source text for the summarizer LLM.
 * @param {import('mongoose').Document} agent
 * @param {{ content: string }[]} mem0Facts
 * @returns {string}
 */
function buildSummarizeSource(agent, mem0Facts) {
  const today = utcDayKey(new Date());
  const dayLogs = Array.isArray(agent.dayLogs) ? agent.dayLogs.slice(0, 5) : [];
  const curated = normalizeEntries(agent.curatedMemory?.entries).slice(0, 40);
  const notes = (Array.isArray(agent.memory) ? agent.memory : [])
    .slice(0, 30)
    .map((m) => String(m?.content || "").trim())
    .filter(Boolean);

  /** @type {string[]} */
  const parts = [`Agent: ${agent.name || agent._id}`, `Today (UTC): ${today}`, ""];

  parts.push("=== DAY HISTORY (recent) ===");
  for (const d of dayLogs) {
    parts.push(`[${d.day}] summary:\n${String(d.summary || "").slice(0, 2000)}`);
    if (d.detail) parts.push(`detail:\n${String(d.detail).slice(0, 2500)}`);
  }

  parts.push("\n=== SHORT NOTES (episodic) ===");
  for (const n of notes) parts.push(`- ${n.slice(0, 500)}`);

  parts.push("\n=== CURATED MEMORY ===");
  for (const c of curated) parts.push(`- ${c.slice(0, 400)}`);

  parts.push("\n=== MEM0 AGENT FACTS ===");
  for (const f of mem0Facts.slice(0, 40)) {
    parts.push(`- ${String(f.content || "").slice(0, 400)}`);
  }

  return parts.join("\n").slice(0, 28_000);
}

/**
 * @param {string} raw
 * @returns {{
 *   daySummary: string,
 *   curatedEntries: string[],
 *   episodicNote: string,
 *   mem0Facts: string[],
 * }|null}
 */
function parseSummarizeJson(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(body.slice(start, end + 1));
    return {
      daySummary: String(obj.daySummary || obj.day_summary || "").trim().slice(0, 3500),
      curatedEntries: (Array.isArray(obj.curatedEntries) ? obj.curatedEntries : [])
        .map((s) => String(s || "").trim())
        .filter(Boolean)
        .slice(0, 40),
      episodicNote: String(obj.episodicNote || obj.episodic_note || "").trim().slice(0, 2000),
      mem0Facts: (Array.isArray(obj.mem0Facts) ? obj.mem0Facts : [])
        .map((s) => String(s || "").trim())
        .filter(Boolean)
        .slice(0, 40),
    };
  } catch {
    return null;
  }
}

/**
 * Summarize one agent if dirty.
 * @param {import('mongoose').Document} agent
 * @returns {Promise<{ ok: boolean, skipped?: string, error?: string }>}
 */
export async function summarizeAgentMemory(agent) {
  const changedAt = agent.memoryContentChangedAt
    ? new Date(agent.memoryContentChangedAt).getTime()
    : 0;
  const lastAt = agent.lastMemorySummarizeAt
    ? new Date(agent.lastMemorySummarizeAt).getTime()
    : 0;
  if (!changedAt || (lastAt && changedAt <= lastAt)) {
    return { ok: false, skipped: "no_new_content" };
  }

  const user = await User.findById(agent.user);
  if (!user) return { ok: false, skipped: "no_user" };
  const creds = await resolveLlmCredentialsForAgent(user, agent);
  if (!creds?.apiKey) return { ok: false, skipped: "no_llm" };

  const mem0Facts = await mem0ListFacts({
    userId: String(agent.user),
    scope: "agent",
    agentId: String(agent._id),
    limit: 60,
  });

  const source = buildSummarizeSource(agent, mem0Facts);
  const system = [
    "You compress an AI agent's memory stores. Remove duplicate trial lists / repeated dumps.",
    "Return ONE JSON object only (no markdown), shape:",
    '{',
    '  "daySummary": "bullet lines for TODAY only — compact, no repeated lists",',
    '  "curatedEntries": ["durable facts only, deduped, max ~20"],',
    '  "episodicNote": "one short rollup of what happened since last summarize",',
    '  "mem0Facts": ["deduped agent facts for Mem0, max ~20"]',
    '}',
    "Keep concrete numbers/names that matter. Drop near-identical trial/expiry dumps.",
  ].join("\n");

  let raw = "";
  try {
    raw = await llmChatCompletion({
      apiKey: creds.apiKey,
      baseUrl: creds.llmBaseUrl || "",
      model: creds.llmModel || "",
      openAiAccountId: creds.openAiAccountId,
      temperature: 0.2,
      maxTokens: 1800,
      timeoutMs: 90_000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: source },
      ],
    });
  } catch (err) {
    return { ok: false, error: String(err?.message || err || "llm_failed") };
  }

  const parsed = parseSummarizeJson(raw);
  if (!parsed) return { ok: false, error: "parse_failed" };

  const today = utcDayKey(new Date());
  const now = new Date();

  // --- Day history: replace today's summary with cleaned bullets ---
  agent.dayLogs = Array.isArray(agent.dayLogs) ? agent.dayLogs : [];
  let dayRow = agent.dayLogs.find((d) => d.day === today);
  if (!dayRow) {
    agent.dayLogs.unshift({
      day: today,
      summary: "",
      keywords: [],
      detail: "",
      sourceTasks: [],
      at: now,
    });
    dayRow = agent.dayLogs[0];
  }
  if (parsed.daySummary) {
    dayRow.summary = parsed.daySummary
      .split(/\n+/)
      .map((l) => l.replace(/^[-•*]\s*/, "").trim())
      .filter(Boolean)
      .map((l) => `• ${l}`)
      .join("\n")
      .slice(0, 4000);
    // Why: detail often held the duplicated trial dump — clear when we have a clean summary.
    if (String(dayRow.detail || "").length > 500) {
      dayRow.detail = String(dayRow.detail || "")
        .slice(0, 1200)
        .concat("\n…[older detail trimmed by memory summarizer]");
    }
    dayRow.at = now;
  }
  agent.markModified("dayLogs");

  // --- Episodic short notes: drop near-dupes, prepend rollup ---
  /** @type {object[]} */
  let notes = Array.isArray(agent.memory) ? [...agent.memory] : [];
  /** @type {object[]} */
  const kept = [];
  for (const n of notes) {
    const c = String(n?.content || "").trim();
    if (!c) continue;
    if (looksLikeListDumpBody(c) || isEphemeralListResult({ summary: c })) continue;
    if (findNearDuplicateIndex(kept.map((x) => ({ content: String(x.content || "") })), c) >= 0) {
      continue;
    }
    kept.push(n);
  }
  if (parsed.episodicNote) {
    const rollupContent = parsed.episodicNote.slice(0, 2000);
    // Why: summarizer must not re-introduce trial/account list dumps into Short notes.
    if (
      !looksLikeListDumpBody(rollupContent) &&
      !isEphemeralListResult({ summary: rollupContent })
    ) {
      const rollup = {
        kind: "note",
        content: rollupContent,
        sourceTask: null,
        at: now,
      };
      const near = findNearDuplicateIndex(
        kept.map((x) => ({ content: String(x.content || "") })),
        rollup.content
      );
      if (near >= 0) {
        kept[near] = { ...kept[near], content: rollup.content, at: now };
      } else {
        kept.unshift(rollup);
      }
    }
  }
  agent.memory = kept.slice(0, 50);
  agent.markModified("memory");

  agent.lastMemorySummarizeAt = now;
  // Why: do not clear memoryContentChangedAt — new writes after this stamp will still trigger.
  await agent.save();

  // Why: curated MEMORY is operator-owned (Memory page) — cron must not rewrite it.

  // --- Mem0: drop obsolete near-dupes; only add facts not already present ---
  if (parsed.mem0Facts.length) {
    try {
      for (const old of mem0Facts.slice(0, 40)) {
        const oldKey = normalizeFactKey(old.content);
        const stillWanted = parsed.mem0Facts.some((n) => {
          const nk = normalizeFactKey(n);
          return nk === oldKey || nk.includes(oldKey) || oldKey.includes(nk);
        });
        if (!stillWanted && oldKey.length >= 20) {
          await mem0DeleteByContent({
            userId: String(agent.user),
            agentId: String(agent._id),
            scope: "agent",
            content: old.content,
          }).catch(() => {});
        }
      }
      for (const fact of parsed.mem0Facts) {
        await mem0AddFact({
          userId: String(agent.user),
          agentId: String(agent._id),
          scope: "agent",
          content: fact,
          metadata: { source: "memory_summarize_cron" },
        }).catch(() => {});
      }
    } catch (err) {
      console.warn("[memorySummarize] mem0 fold failed:", err?.message || err);
    }
  }

  // Reload lastSummarizeAt already set; avoid re-trigger from our curated/mem0 writes.
  try {
    await Agent.updateOne(
      { _id: agent._id },
      { $set: { lastMemorySummarizeAt: now } }
    );
  } catch {
    /* ignore */
  }

  return { ok: true };
}

/**
 * Scan all agents; summarize those with new content since last cron.
 * @returns {Promise<{ checked: number, ran: number, skipped: number, errors: number }>}
 */
export async function tickMemorySummarize() {
  /** @type {{ checked: number, ran: number, skipped: number, errors: number }} */
  const stats = { checked: 0, ran: 0, skipped: 0, errors: 0 };
  let agents = [];
  try {
    agents = await findAgentsNeedingMemorySummarize();
  } catch (err) {
    console.error("[memorySummarize] find failed:", err?.message || err);
    return stats;
  }
  stats.checked = agents.length;
  for (const agent of agents) {
    try {
      const result = await summarizeAgentMemory(agent);
      if (result.ok) stats.ran += 1;
      else if (result.error) {
        stats.errors += 1;
        console.warn(
          `[memorySummarize] agent ${agent._id} error:`,
          result.error
        );
      } else stats.skipped += 1;
    } catch (err) {
      stats.errors += 1;
      console.warn(
        `[memorySummarize] agent ${agent._id} threw:`,
        err?.message || err
      );
    }
  }
  return stats;
}
