/**
 * @fileoverview Built-in semantic curated-memory retrieval for YamBot prompts.
 * Purpose: Inject top-k USER/MEMORY facts relevant to the current goal (Hermes-style),
 * instead of dumping the entire curated store into every run.
 * Downstream: enqueueTask, chats, agentMessageBus, scheduler, goals; curatedMemoryOps.
 */

import { extractMemoryKeywords } from "../models/Agent.js";
import {
  MEMORY_CHAR_LIMIT,
  USER_CHAR_LIMIT,
  charCount,
  normalizeEntryRecords,
  toPersistableEntries,
} from "./curatedMemory.js";
import { embedOne, embedTexts, embeddingsSupported } from "./llmEmbed.js";

/** When store is small, inject everything (no retrieval noise). */
export const SEMANTIC_FULL_INJECT_BELOW = 10;

/** Max curated entries injected per store after semantic / keyword rank. */
export const SEMANTIC_TOP_K = 8;

/**
 * Cosine similarity in [0, 1] (clamped); 0 when invalid.
 * @param {number[]|null|undefined} a
 * @param {number[]|null|undefined} b
 * @returns {number}
 */
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na <= 0 || nb <= 0) return 0;
  const sim = dot / (Math.sqrt(na) * Math.sqrt(nb));
  if (!Number.isFinite(sim)) return 0;
  return Math.max(0, Math.min(1, sim));
}

/**
 * Keyword overlap score (same spirit as day-log retrieval).
 * @param {string} query
 * @param {string} content
 * @returns {number}
 */
export function keywordScore(query, content) {
  const q = extractMemoryKeywords(query);
  if (!q.length) return 0;
  const hay = String(content || "").toLowerCase();
  let n = 0;
  for (const tok of q) {
    if (hay.includes(tok)) n += 1;
  }
  return n;
}

/**
 * Stamp missing embeddings onto curated records (mutates copies).
 * @param {{ content: string, at: Date|null, embedding?: number[]|null }[]} records
 * @param {{ apiKey?: string, llmBaseUrl?: string }} creds
 * @returns {Promise<{ records: typeof records, updated: boolean }>}
 */
export async function ensureEntryEmbeddings(records, creds) {
  const list = normalizeEntryRecords(records).map((r) => ({
    ...r,
    embedding: Array.isArray(r.embedding) && r.embedding.length ? r.embedding : null,
  }));
  const baseUrl = creds?.llmBaseUrl || "";
  if (!creds?.apiKey || !embeddingsSupported(baseUrl)) {
    return { records: list, updated: false };
  }
  const missingIdx = [];
  for (let i = 0; i < list.length; i++) {
    if (!list[i].embedding) missingIdx.push(i);
  }
  if (!missingIdx.length) return { records: list, updated: false };

  const vectors = await embedTexts({
    apiKey: creds.apiKey,
    baseUrl,
    texts: missingIdx.map((i) => list[i].content),
  });
  let updated = false;
  missingIdx.forEach((recIdx, j) => {
    const v = vectors[j];
    if (Array.isArray(v) && v.length) {
      list[recIdx].embedding = v;
      updated = true;
    }
  });
  return { records: list, updated };
}

/**
 * Rank + trim curated entries for one prompt store.
 * @param {unknown[]|undefined|null} rawEntries
 * @param {string} goal
 * @param {{ apiKey?: string, llmBaseUrl?: string }|null} creds
 * @param {number} charLimit
 * @returns {Promise<{
 *   contents: string[],
 *   records: { content: string, at: Date|null, embedding?: number[]|null }[],
 *   mode: "all"|"semantic"|"keyword",
 *   selected: number,
 *   total: number,
 * }>}
 */
export async function selectCuratedSubset(rawEntries, goal, creds, charLimit) {
  const { records: withEmb } = await ensureEntryEmbeddings(
    normalizeEntryRecords(rawEntries),
    creds || {}
  );
  const total = withEmb.length;
  if (!total) {
    return { contents: [], scores: [], records: [], mode: "all", selected: 0, total: 0 };
  }

  const goalText = String(goal || "").trim();
  // Why: tiny stores — full inject is cheaper and avoids dropping useful facts.
  if (!goalText || total <= SEMANTIC_FULL_INJECT_BELOW) {
    const fitted = fitByChars(withEmb, charLimit);
    return {
      contents: fitted.map((r) => r.content),
      scores: fitted.map(() => 0),
      records: fitted,
      mode: "all",
      selected: fitted.length,
      total,
    };
  }

  let mode = "keyword";
  /** @type {{ record: typeof withEmb[0], score: number }[]} */
  let ranked = [];

  const queryEmb =
    creds?.apiKey && embeddingsSupported(creds.llmBaseUrl || "")
      ? await embedOne(creds, goalText)
      : null;

  if (queryEmb) {
    mode = "semantic";
    ranked = withEmb.map((record) => ({
      record,
      score: record.embedding
        ? cosineSimilarity(queryEmb, record.embedding)
        : keywordScore(goalText, record.content) * 0.05,
    }));
  } else {
    ranked = withEmb.map((record) => ({
      record,
      score: keywordScore(goalText, record.content),
    }));
  }

  ranked.sort((a, b) => b.score - a.score);
  const maxScore = ranked[0]?.score || 0;
  // Why: don't pad the prompt with near-zero matches just to fill TOP_K.
  const minKeep =
    mode === "semantic" ? Math.max(0.22, maxScore * 0.55) : maxScore >= 1 ? 1 : 0;

  // Why: keep a floor of newest entries so brand-new facts aren't starved by old high scorers —
  // but only if they clear a soft relevance floor (or the store is sparse).
  const newest = [...withEmb]
    .sort((a, b) => {
      const ta = a.at ? new Date(a.at).getTime() : 0;
      const tb = b.at ? new Date(b.at).getTime() : 0;
      return tb - ta;
    })
    .slice(0, 2);

  /** @type {Map<string, typeof withEmb[0]>} */
  const picked = new Map();
  for (const row of ranked.slice(0, SEMANTIC_TOP_K)) {
    if (row.score < minKeep) continue;
    picked.set(row.record.content, row.record);
  }
  for (const n of newest) {
    if (picked.size >= SEMANTIC_TOP_K) break;
    const score =
      ranked.find((r) => r.record.content === n.content)?.score ??
      keywordScore(goalText, n.content);
    // Soft floor: always keep brand-new notes unless totally unrelated on keyword path.
    if (mode === "keyword" && score < 1 && maxScore >= 2) continue;
    if (mode === "semantic" && score < minKeep * 0.5 && maxScore >= 0.4) continue;
    picked.set(n.content, n);
  }

  let selected = [...picked.values()];
  if (!selected.length) {
    selected = ranked.slice(0, Math.min(4, SEMANTIC_TOP_K)).map((r) => r.record);
  }
  // Preserve rank order (highest score first) for the prompt.
  selected.sort((a, b) => {
    const sa = ranked.find((r) => r.record.content === a.content)?.score || 0;
    const sb = ranked.find((r) => r.record.content === b.content)?.score || 0;
    return sb - sa;
  });
  const fitted = fitByChars(selected, charLimit);
  const scores = fitted.map(
    (r) => ranked.find((row) => row.record.content === r.content)?.score || 0
  );
  return {
    contents: fitted.map((r) => r.content),
    scores,
    records: fitted,
    mode,
    selected: fitted.length,
    total,
  };
}

/**
 * Prefer higher-priority order already in `records`; trim by char budget.
 * @param {{ content: string }[]} records
 * @param {number} charLimit
 */
function fitByChars(records, charLimit) {
  const limit = Math.max(200, Number(charLimit) || MEMORY_CHAR_LIMIT);
  /** @type {typeof records} */
  const out = [];
  for (const r of records) {
    const next = [...out, r];
    if (charCount(next.map((x) => x.content)) > limit) {
      if (!out.length) out.push({ ...r, content: r.content.slice(0, limit) });
      break;
    }
    out.push(r);
  }
  return out;
}

/**
 * Resolve USER + agent MEMORY subsets for a task/chat snapshot.
 * Optionally persists newly computed embeddings back onto the documents.
 * @param {{
 *   userEntries: unknown[]|undefined|null,
 *   agentEntries: unknown[]|undefined|null,
 *   goal: string,
 *   creds?: { apiKey?: string, llmBaseUrl?: string }|null,
 *   userDoc?: import('mongoose').Document|null,
 *   agentDoc?: import('mongoose').Document|null,
 *   persistEmbeddings?: boolean,
 * }} opts
 * @returns {Promise<{
 *   userCuratedEntries: string[],
 *   agentCuratedEntries: string[],
 *   meta: object,
 * }>}
 */
export async function resolveCuratedMemoryForPrompt(opts) {
  const creds = opts.creds || null;
  const [userSel, agentSel] = await Promise.all([
    selectCuratedSubset(opts.userEntries, opts.goal, creds, USER_CHAR_LIMIT),
    selectCuratedSubset(opts.agentEntries, opts.goal, creds, MEMORY_CHAR_LIMIT),
  ]);

  if (opts.persistEmbeddings) {
    await persistEmbeddingsIfNeeded(opts.userDoc, opts.userEntries, creds, "user");
    await persistEmbeddingsIfNeeded(opts.agentDoc, opts.agentEntries, creds, "agent");
  }

  return {
    userCuratedEntries: userSel.contents,
    agentCuratedEntries: agentSel.contents,
    meta: {
      user: {
        mode: userSel.mode,
        selected: userSel.selected,
        total: userSel.total,
        pulled: userSel.contents.map((content, i) => ({
          rank: i + 1,
          score: Number(userSel.scores?.[i] || 0),
          content,
        })),
      },
      agent: {
        mode: agentSel.mode,
        selected: agentSel.selected,
        total: agentSel.total,
        pulled: agentSel.contents.map((content, i) => ({
          rank: i + 1,
          score: Number(agentSel.scores?.[i] || 0),
          content,
        })),
      },
    },
  };
}

/**
 * One-line + detail body for the chat Memory bubble.
 * @param {object} meta — resolveCuratedMemoryForPrompt().meta
 * @returns {string}
 */
export function formatCuratedPullMessageContent(meta) {
  const agent = meta?.agent || {};
  const user = meta?.user || {};
  const lines = [
    `Memory pull · agent ${agent.mode || "?"} ${agent.selected || 0}/${agent.total || 0}` +
      (user.total
        ? ` · user ${user.mode || "?"} ${user.selected || 0}/${user.total || 0}`
        : ""),
  ];
  if (Array.isArray(agent.pulled) && agent.pulled.length) {
    lines.push("", "Agent MEMORY (ranked):");
    for (const row of agent.pulled) {
      const sc =
        typeof row.score === "number" && row.score > 0
          ? ` [${row.score.toFixed(2)}]`
          : "";
      lines.push(`${row.rank}. ${row.content}${sc}`);
    }
  } else {
    lines.push("", "Agent MEMORY: (none pulled)");
  }
  if (Array.isArray(user.pulled) && user.pulled.length) {
    lines.push("", "USER prefs (ranked):");
    for (const row of user.pulled) {
      const sc =
        typeof row.score === "number" && row.score > 0
          ? ` [${row.score.toFixed(2)}]`
          : "";
      lines.push(`${row.rank}. ${row.content}${sc}`);
    }
  }
  return lines.join("\n");
}

/**
 * Post a clickable Memory chip into the chat thread.
 * @param {{ chatId: string|object, taskId?: string|object|null, curatedMeta: object }} opts
 * @returns {Promise<object|null>}
 */
export async function postCuratedPullMessage(opts) {
  const chatId = opts.chatId;
  const meta = opts.curatedMeta;
  if (!chatId || !meta) return null;
  const { Message } = await import("../models/Chat.js");
  const agentSelected = Number(meta?.agent?.selected || 0);
  const userSelected = Number(meta?.user?.selected || 0);
  if (agentSelected + userSelected === 0 && !Number(meta?.agent?.total || 0) && !Number(meta?.user?.total || 0)) {
    // Still post so empty stores are visible during testing.
  }
  return Message.create({
    chat: chatId,
    role: "system",
    content: formatCuratedPullMessageContent(meta),
    meta: {
      kind: "curated_pull",
      ui: "icon",
      taskId: opts.taskId || null,
      curatedMemory: meta,
    },
  });
}

/**
 * Write back embeddings onto curatedMemory.entries without changing content/updatedAt semantics.
 * @param {import('mongoose').Document|null|undefined} doc
 * @param {unknown[]|undefined|null} rawEntries
 * @param {{ apiKey?: string, llmBaseUrl?: string }|null} creds
 * @param {"user"|"agent"} kind
 */
async function persistEmbeddingsIfNeeded(doc, rawEntries, creds, kind) {
  if (!doc || !creds?.apiKey) return;
  const { records, updated } = await ensureEntryEmbeddings(
    normalizeEntryRecords(rawEntries),
    creds
  );
  if (!updated) return;
  try {
    doc.curatedMemory = {
      entries: toPersistableEntries(records),
      updatedAt: doc.curatedMemory?.updatedAt || new Date(),
    };
    doc.markModified?.("curatedMemory");
    await doc.save();
  } catch (err) {
    console.warn(`[semanticMemory] persist ${kind} embeddings failed:`, err?.message || err);
  }
}

/**
 * Embed a single new/replaced entry content (for memory tool / UI add).
 * @param {string} content
 * @param {{ apiKey?: string, llmBaseUrl?: string }|null} creds
 * @returns {Promise<number[]|null>}
 */
export async function embedCuratedContent(content, creds) {
  if (!creds?.apiKey) return null;
  return embedOne(creds, content);
}
