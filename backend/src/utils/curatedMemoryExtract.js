/**
 * @fileoverview Post-run durable-fact extraction for agents.
 * Purpose: After a successful task, distill durable facts into Mem0 only (not curated Mongo),
 * so Memory-page curated stays operator-owned and facts are not double-saved.
 * Downstream: worker task complete, apiAgentRunner; mem0AddFact; chat Mem0 chip.
 */

import { Agent } from "../models/Agent.js";
import { Message } from "../models/Chat.js";
import { Task } from "../models/Task.js";
import { llmChatCompletion } from "./llmChat.js";
import { resolveLlmCredentialsForAgent } from "./llmCredentials.js";
import { normalizeEntries } from "./curatedMemory.js";
import {
  filterDurableCuratedFacts,
  isEphemeralCuratedFact,
  isEphemeralListResult,
} from "./curatedMemoryFilter.js";
import { writeAudit } from "./audit.js";

const MAX_FACTS = 5;
const MAX_FACT_CHARS = 320;
/** Bump when extract prompt/heuristics change enough to re-run for the same task. */
export const MEMORY_EXTRACT_VERSION = 1;

/**
 * @param {string} text
 * @returns {string[]}
 */
function heuristicFacts(text) {
  const raw = String(text || "");
  /** @type {string[]} */
  const out = [];
  const remembered = raw.match(/Remembered:\s*(.+)/i);
  if (remembered?.[1]) {
    const fact = remembered[1].trim().slice(0, MAX_FACT_CHARS);
    if (!isEphemeralCuratedFact(fact)) out.push(fact);
  }
  // Why: do NOT match Auto goals that start with "That means count…" — those are task pins, not facts.
  const means = raw.match(
    /\b([A-Za-z][\w.-]{1,40})\s+means\s+(https?:\/\/\S+|[a-z0-9.-]+\.[a-z]{2,}(?:\/\S*)?)/i
  );
  if (means) {
    const fact = `${means[1].trim()} means ${means[2].trim()}`.slice(0, MAX_FACT_CHARS);
    if (!isEphemeralCuratedFact(fact)) out.push(fact);
  }
  if (/\b(crm|vughy)\b/i.test(raw) && /\b(register|registration|account|signup|sign up)\b/i.test(raw)) {
    if (/\bdummy\b/i.test(raw)) {
      out.push(
        "When registering a CRM (Vughy) account without details, use dummy data to complete the form."
      );
    }
    if (/\b(completed|success|active)\b/i.test(raw)) {
      out.push("CRM account registration on Vughy.com can be completed with dummy signup details.");
    }
  }
  return filterDurableCuratedFacts([...new Set(out.filter(Boolean))]);
}

/**
 * @param {string} content
 * @returns {string[]}
 */
function parseFactsJson(content) {
  const raw = String(content || "").trim();
  if (!raw) return [];
  let parsed = null;
  try {
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fence ? fence[1].trim() : raw;
    const brace = candidate.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(brace ? brace[0] : candidate);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed?.facts)
    ? parsed.facts
    : Array.isArray(parsed)
      ? parsed
      : [];
  return list
    .map((f) => String(f || "").trim().replace(/\s+/g, " "))
    .filter((f) => f.length >= 8 && f.length <= MAX_FACT_CHARS)
    .slice(0, MAX_FACTS);
}

/**
 * Ask the account LLM for durable agent facts from this run (empty ok).
 * @param {{
 *   userId: string,
 *   agentId: string,
 *   goal: string,
 *   summary: string,
 *   trajectoryDigest?: string,
 * }} opts
 * @returns {Promise<string[]>}
 */
async function llmExtractFacts(opts) {
  const creds = await resolveLlmCredentialsForAgent(opts.userId, opts.agentId);
  if (!creds?.apiKey) return [];

  const prompt = [
    "Extract durable facts worth saving in THIS agent's long-term MEMORY for future runs.",
    "Return ONLY JSON: {\"facts\":[\"...\"]}",
    "Rules:",
    "- 0 to 5 short facts (≤320 chars each).",
    "- Prefer stable mappings, site URLs, login paths, preferences the human taught, successful signup patterns.",
    "- Skip one-off navigation (“opened Google”), ephemeral UI, passwords/secrets, and chatter.",
    "- NEVER save the GOAL text itself, ACTIVE USER MESSAGE pins, or if/then task conditions (e.g. “if count > 1 message agent”).",
    "- NEVER save peer-message instructions or one-off counters/filters from a single run.",
    "- If nothing durable, return {\"facts\":[]}.",
    "",
    `GOAL:\n${String(opts.goal || "").slice(0, 800)}`,
    "",
    `RESULT:\n${String(opts.summary || "").slice(0, 1200)}`,
    opts.trajectoryDigest
      ? `\nTRAJECTORY (last steps):\n${String(opts.trajectoryDigest).slice(0, 1200)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const content = await llmChatCompletion({
      apiKey: creds.apiKey,
      baseUrl: creds.baseUrl,
      model: creds.model,
      messages: [
        {
          role: "system",
          content: "You extract durable agent memory facts. Reply with JSON only.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0,
      maxTokens: 400,
      timeoutMs: 18_000,
      openAiAccountId: creds.openAiAccountId,
    });
    return parseFactsJson(content);
  } catch (err) {
    console.warn("[curatedMemoryExtract] LLM extract failed:", err?.message || err);
    return [];
  }
}

/**
 * @param {string[]} facts
 * @param {string[]} existing
 * @returns {string[]}
 */
function dedupeFacts(facts, existing) {
  const have = new Set(
    (existing || []).map((e) => String(e || "").trim().toLowerCase()).filter(Boolean)
  );
  /** @type {string[]} */
  const out = [];
  for (const f of facts) {
    const key = f.toLowerCase();
    if (!key || have.has(key)) continue;
    // Why: near-duplicates (“CRM means vughy.com.” vs “… vughy.com”) — skip if already contained.
    let overlap = false;
    for (const h of have) {
      if (h.includes(key) || key.includes(h)) {
        overlap = true;
        break;
      }
    }
    if (overlap) continue;
    have.add(key);
    out.push(f);
  }
  return out;
}

/**
 * Persist durable facts from a finished run into agent curated MEMORY.
 * Best-effort — never throws to the complete handler.
 * @param {{
 *   userId: string,
 *   agentId: string,
 *   chatId?: string|null,
 *   taskId?: string|null,
 *   goal: string,
 *   summary: string,
 *   trajectoryDigest?: string,
 *   success?: boolean,
 * }} opts
 * @returns {Promise<{ ok: boolean, saved: string[], skipped?: string }>}
 */
export async function persistCuratedMemoryFromRun(opts) {
  const userId = String(opts.userId || "").trim();
  const agentId = String(opts.agentId || "").trim();
  const summary = String(opts.summary || "").trim();
  const taskId = opts.taskId ? String(opts.taskId).trim() : "";
  if (!userId || !agentId || !summary) {
    return { ok: false, saved: [], skipped: "missing" };
  }
  // Why: failed runs still get day logs / avoid notes — curated MEMORY stays for durable wins.
  if (opts.success === false) {
    return { ok: true, saved: [], skipped: "failed_run" };
  }
  // Why: “get the list” results belong in chat only — do not distill rows into curated MEMORY.
  if (
    isEphemeralListResult({
      goal: String(opts.goal || ""),
      summary,
    })
  ) {
    return { ok: true, saved: [], skipped: "ephemeral_list" };
  }

  // Phase 2: idempotent extract — complete retries must not re-LLM and re-save.
  if (taskId) {
    try {
      const task = await Task.findById(taskId).select("workingState").lean();
      const ws = task?.workingState && typeof task.workingState === "object" ? task.workingState : {};
      if (
        ws.memoryExtractAt &&
        Number(ws.memoryExtractVersion || 0) >= MEMORY_EXTRACT_VERSION
      ) {
        return { ok: true, saved: [], skipped: "already_extracted" };
      }
      const priorChip = await Message.findOne({
        "meta.kind": "curated_save",
        "meta.taskId": taskId,
      })
        .select("_id")
        .lean();
      if (priorChip) {
        await Task.updateOne(
          { _id: taskId },
          {
            $set: {
              "workingState.memoryExtractAt": new Date(),
              "workingState.memoryExtractVersion": MEMORY_EXTRACT_VERSION,
              "workingState.memoryExtractKey": `${taskId}:v${MEMORY_EXTRACT_VERSION}`,
            },
          }
        ).catch(() => null);
        return { ok: true, saved: [], skipped: "already_extracted" };
      }
    } catch (err) {
      console.warn("[curatedMemoryExtract] idempotency check failed:", err?.message || err);
    }
  }

  try {
    const agent = await Agent.findOne({ _id: agentId, user: userId })
      .select("curatedMemory")
      .lean();
    if (!agent) return { ok: false, saved: [], skipped: "agent_missing" };

    let facts = await llmExtractFacts({
      userId,
      agentId,
      goal: opts.goal,
      summary,
      trajectoryDigest: opts.trajectoryDigest,
    });
    if (!facts.length) {
      facts = heuristicFacts(`${opts.goal}\n${summary}`);
    }
    // Why: strip goal/if-rule dumps even when the LLM returns them.
    facts = filterDurableCuratedFacts(facts);
    facts = dedupeFacts(facts, normalizeEntries(agent.curatedMemory?.entries));
    if (!facts.length) {
      if (taskId) {
        await Task.updateOne(
          { _id: taskId },
          {
            $set: {
              "workingState.memoryExtractAt": new Date(),
              "workingState.memoryExtractVersion": MEMORY_EXTRACT_VERSION,
              "workingState.memoryExtractKey": `${taskId}:v${MEMORY_EXTRACT_VERSION}`,
              "workingState.memoryExtractSkipped": "none",
            },
          }
        ).catch(() => null);
      }
      void writeAudit({
        userId,
        agentId,
        taskId: taskId || null,
        action: "memory_extract_skip",
        detail: "no durable facts",
        meta: { reason: "none", version: MEMORY_EXTRACT_VERSION },
      });
      return { ok: true, saved: [], skipped: "none" };
    }

    /** @type {string[]} */
    const saved = [];
    /** @type {string[]} */
    const rejected = [];
    const { mem0AddFact } = await import("./mem0Service.js");
    for (const content of facts) {
      // Why: run extract writes Mem0 only — curated MEMORY stays for Memory-page / tool edits.
      const result = await mem0AddFact({
        userId,
        agentId,
        scope: "agent",
        content,
        metadata: { source: "run_extract", sourceRef: taskId || null },
      });
      if (result?.ok) saved.push(content);
      else if (result?.skipped === "duplicate") {
        /* already present — not a failure */
      } else if (result?.skipped) {
        rejected.push(`${content.slice(0, 60)}… (${result.skipped})`);
      }
    }

    if (taskId) {
      await Task.updateOne(
        { _id: taskId },
        {
          $set: {
            "workingState.memoryExtractAt": new Date(),
            "workingState.memoryExtractVersion": MEMORY_EXTRACT_VERSION,
            "workingState.memoryExtractKey": `${taskId}:v${MEMORY_EXTRACT_VERSION}`,
            "workingState.memoryExtractSaved": saved.length,
          },
        }
      ).catch(() => null);
    }

    if (saved.length && opts.chatId) {
      const lines = [
        `Mem0 saved · ${saved.length} agent fact${saved.length === 1 ? "" : "s"}`,
        "",
        ...saved.map((f, i) => `${i + 1}. ${f}`),
      ];
      if (rejected.length) {
        lines.push("", `Rejected: ${rejected.length}`);
      }
      await Message.create({
        chat: opts.chatId,
        role: "system",
        content: lines.join("\n"),
        meta: {
          kind: "curated_save",
          ui: "icon",
          taskId: taskId || null,
          curatedSave: {
            target: "mem0",
            count: saved.length,
            facts: saved,
            source: "run_extract",
            rejected: rejected.length ? rejected : undefined,
            extractVersion: MEMORY_EXTRACT_VERSION,
          },
        },
      }).catch(() => null);
    }

    void writeAudit({
      userId,
      agentId,
      taskId: taskId || null,
      action: "memory_extract_done",
      detail: `saved ${saved.length}`,
      meta: {
        saved: saved.length,
        rejected: rejected.length,
        version: MEMORY_EXTRACT_VERSION,
      },
    });

    return { ok: true, saved };
  } catch (err) {
    console.warn("[curatedMemoryExtract] persist failed:", err?.message || err);
    return { ok: false, saved: [], skipped: "error" };
  }
}
