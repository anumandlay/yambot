/**
 * @fileoverview Self-hosted Mem0 (OSS SDK + Qdrant) for YamBot long-term memory.
 * Purpose: Clearer fact extract/retrieve than dumping Hermes USER/MEMORY blocks alone.
 * Inputs: MEM0_ENABLED, Qdrant URL, DEFAULT_LLM_* (or MEM0_* overrides).
 * Downstream: semanticMemory resolve, curatedMemoryOps writes, chats Auto turns.
 * Why: Official mem0-api-server Hub image is stale; in-process OSS + Qdrant keeps data on our VPS.
 */

import { env } from "./env.js";
import { isEphemeralCuratedFact } from "./curatedMemoryFilter.js";

/** Sentinel agent_id for account-wide USER prefs in Mem0. */
export const MEM0_USER_SCOPE_AGENT = "yambot_user_profile";

/** @type {import("mem0ai/oss").Memory|null} */
let memorySingleton = null;
/** @type {Promise<import("mem0ai/oss").Memory|null>|null} */
let memoryInitPromise = null;

/**
 * @returns {boolean}
 */
export function isMem0Enabled() {
  const flag = String(process.env.MEM0_ENABLED || env.MEM0_ENABLED || "").trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off" || flag === "no") return false;
  if (flag === "1" || flag === "true" || flag === "on" || flag === "yes") return true;
  // Why: enabled automatically in production compose when Qdrant is wired; local stays opt-in.
  return Boolean(String(process.env.MEM0_QDRANT_URL || env.MEM0_QDRANT_URL || "").trim());
}

/**
 * @param {string|object|null|undefined} id
 * @returns {string}
 */
export function mem0UserKey(id) {
  const s = String(id || "").trim();
  return s ? `yb_u_${s}` : "";
}

/**
 * @param {string|object|null|undefined} id
 * @returns {string}
 */
export function mem0AgentKey(id) {
  const s = String(id || "").trim();
  return s ? `yb_a_${s}` : "";
}

/**
 * Resolve LLM/embed credentials for Mem0 (site default, optional MEM0_* override).
 * @returns {{ apiKey: string, baseURL: string, model: string, embedModel: string, embedDims: number }|null}
 */
function resolveMem0LlmConfig() {
  const apiKey = String(
    process.env.MEM0_LLM_API_KEY || env.MEM0_LLM_API_KEY || env.DEFAULT_LLM_API_KEY || ""
  ).trim();
  if (!apiKey) return null;
  const baseURL = String(
    process.env.MEM0_LLM_BASE_URL ||
      env.MEM0_LLM_BASE_URL ||
      env.DEFAULT_LLM_BASE_URL ||
      ""
  )
    .trim()
    .replace(/\/$/, "");
  const model = String(
    process.env.MEM0_LLM_MODEL || env.MEM0_LLM_MODEL || env.DEFAULT_LLM_MODEL || ""
  ).trim();
  const embedModel = String(
    process.env.MEM0_EMBEDDER_MODEL || env.MEM0_EMBEDDER_MODEL || "text-embedding-3-small"
  ).trim();
  const embedDims = Math.max(
    64,
    Number(process.env.MEM0_EMBEDDING_DIMS || env.MEM0_EMBEDDING_DIMS || 1536) || 1536
  );
  return { apiKey, baseURL, model, embedModel, embedDims };
}

/**
 * Lazy-init Mem0 Memory (one process-wide client → shared Qdrant collection).
 * @returns {Promise<import("mem0ai/oss").Memory|null>}
 */
export async function getMem0Memory() {
  if (!isMem0Enabled()) return null;
  if (memorySingleton) return memorySingleton;
  if (memoryInitPromise) return memoryInitPromise;

  memoryInitPromise = (async () => {
    const llm = resolveMem0LlmConfig();
    if (!llm) {
      console.warn("[mem0] enabled but no LLM API key — set DEFAULT_LLM_API_KEY or MEM0_LLM_API_KEY");
      return null;
    }
    const qdrantUrl = String(
      process.env.MEM0_QDRANT_URL || env.MEM0_QDRANT_URL || "http://127.0.0.1:6333"
    ).trim();
    const collectionName = String(
      process.env.MEM0_COLLECTION || env.MEM0_COLLECTION || "yambot_memories"
    ).trim();

    try {
      const { Memory } = await import("mem0ai/oss");
      const instance = new Memory({
        // Why: avoid better-sqlite3 native build in slim Docker images.
        disableHistory: true,
        llm: {
          provider: "openai",
          config: {
            apiKey: llm.apiKey,
            model: llm.model || "gpt-4o-mini",
            baseURL: llm.baseURL || undefined,
            temperature: 0.1,
          },
        },
        embedder: {
          provider: "openai",
          config: {
            apiKey: llm.apiKey,
            model: llm.embedModel,
            baseURL: llm.baseURL || undefined,
            embeddingDims: llm.embedDims,
          },
        },
        vectorStore: {
          provider: "qdrant",
          config: {
            url: qdrantUrl,
            collectionName,
            embeddingModelDims: llm.embedDims,
          },
        },
      });
      memorySingleton = instance;
      console.log(`[mem0] ready · qdrant=${qdrantUrl} · collection=${collectionName}`);
      return instance;
    } catch (err) {
      console.warn("[mem0] init failed:", err?.message || err);
      memorySingleton = null;
      return null;
    }
  })();

  try {
    return await memoryInitPromise;
  } finally {
    // Why: allow retry after transient Qdrant downtime on next call.
    if (!memorySingleton) memoryInitPromise = null;
  }
}

/**
 * Normalize Mem0 search payload into plain fact strings.
 * @param {unknown} result
 * @returns {{ memory: string, score: number, id?: string }[]}
 */
export function normalizeMem0SearchResults(result) {
  const rows = Array.isArray(result?.results)
    ? result.results
    : Array.isArray(result)
      ? result
      : [];
  /** @type {{ memory: string, score: number, id?: string }[]} */
  const out = [];
  for (const row of rows) {
    const memory = String(row?.memory || row?.data || row?.text || "").trim();
    if (!memory || isEphemeralCuratedFact(memory)) continue;
    const score = Number(row?.score);
    out.push({
      memory,
      score: Number.isFinite(score) ? score : 0,
      id: row?.id ? String(row.id) : undefined,
    });
  }
  return out;
}

/**
 * Search Mem0 for facts relevant to a goal/query.
 * @param {{
 *   userId: string,
 *   agentId?: string|null,
 *   scope?: "user"|"agent",
 *   query: string,
 *   topK?: number,
 *   threshold?: number,
 * }} opts
 * @returns {Promise<{ memory: string, score: number, id?: string }[]>}
 */
export async function mem0SearchFacts(opts) {
  const query = String(opts.query || "").trim();
  const userKey = mem0UserKey(opts.userId);
  if (!query || !userKey) return [];
  const memory = await getMem0Memory();
  if (!memory) return [];

  const scope = opts.scope === "user" ? "user" : "agent";
  const agentKey =
    scope === "user" ? MEM0_USER_SCOPE_AGENT : mem0AgentKey(opts.agentId);
  if (!agentKey) return [];

  try {
    const result = await memory.search(query, {
      filters: {
        user_id: userKey,
        agent_id: agentKey,
      },
      topK: Math.min(20, Math.max(1, Number(opts.topK) || 8)),
      threshold: Number.isFinite(Number(opts.threshold)) ? Number(opts.threshold) : 0.15,
    });
    return normalizeMem0SearchResults(result);
  } catch (err) {
    console.warn("[mem0] search failed:", err?.message || err);
    return [];
  }
}

/**
 * Store a durable fact without LLM re-extraction (Hermes curated write path).
 * @param {{
 *   userId: string,
 *   agentId?: string|null,
 *   scope?: "user"|"agent",
 *   content: string,
 *   metadata?: Record<string, unknown>,
 * }} opts
 * @returns {Promise<{ ok: boolean, skipped?: string }>}
 */
export async function mem0AddFact(opts) {
  const content = String(opts.content || "").trim();
  const userKey = mem0UserKey(opts.userId);
  if (!content || !userKey) return { ok: false, skipped: "missing" };
  if (isEphemeralCuratedFact(content)) return { ok: false, skipped: "ephemeral" };

  const memory = await getMem0Memory();
  if (!memory) return { ok: false, skipped: "disabled" };

  const scope = opts.scope === "user" ? "user" : "agent";
  const agentKey =
    scope === "user" ? MEM0_USER_SCOPE_AGENT : mem0AgentKey(opts.agentId);
  if (!agentKey) return { ok: false, skipped: "no_agent" };

  try {
    await memory.add([{ role: "user", content }], {
      userId: userKey,
      agentId: agentKey,
      infer: false,
      metadata: {
        source: "yambot_curated",
        scope,
        ...(opts.metadata && typeof opts.metadata === "object" ? opts.metadata : {}),
      },
    });
    return { ok: true };
  } catch (err) {
    console.warn("[mem0] addFact failed:", err?.message || err);
    return { ok: false, skipped: "error" };
  }
}

/**
 * Ingest a chat turn so Mem0 can extract durable facts (async-safe).
 * @param {{
 *   userId: string,
 *   agentId?: string|null,
 *   userText: string,
 *   assistantText: string,
 * }} opts
 * @returns {Promise<{ ok: boolean, skipped?: string }>}
 */
export async function mem0IngestChatTurn(opts) {
  const userText = String(opts.userText || "").trim();
  const assistantText = String(opts.assistantText || "").trim();
  const userKey = mem0UserKey(opts.userId);
  const agentKey = mem0AgentKey(opts.agentId);
  if (!userKey || !agentKey) return { ok: false, skipped: "missing" };
  if (!userText || userText.length < 2) return { ok: false, skipped: "short" };
  // Why: skip empty/cheap greetings — nothing durable to learn.
  if (/^(hi|hello|hey|ok|okay|thanks|thank you|yo|sup)[.!\s]*$/i.test(userText)) {
    return { ok: false, skipped: "greeting" };
  }

  const memory = await getMem0Memory();
  if (!memory) return { ok: false, skipped: "disabled" };

  const messages = [
    { role: "user", content: userText.slice(0, 4000) },
    ...(assistantText
      ? [{ role: "assistant", content: assistantText.slice(0, 4000) }]
      : []),
  ];

  try {
    await memory.add(messages, {
      userId: userKey,
      agentId: agentKey,
      infer: true,
      metadata: { source: "yambot_chat", scope: "agent" },
    });
    return { ok: true };
  } catch (err) {
    console.warn("[mem0] ingestChatTurn failed:", err?.message || err);
    return { ok: false, skipped: "error" };
  }
}

/**
 * Merge Mem0 hits into a curated string list (dedupe, ephemeral filter, char budget).
 * @param {string[]} curated
 * @param {{ memory: string, score: number }[]} mem0Hits
 * @param {number} charLimit
 * @returns {{ contents: string[], mem0Added: number }}
 */
export function mergeMem0IntoCurated(curated, mem0Hits, charLimit) {
  const limit = Math.max(200, Number(charLimit) || 8000);
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  let chars = 0;
  let mem0Added = 0;

  const push = (text, fromMem0) => {
    const t = String(text || "").trim();
    if (!t || isEphemeralCuratedFact(t)) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    if (chars + t.length > limit && out.length) return;
    seen.add(key);
    out.push(t);
    chars += t.length + 2;
    if (fromMem0) mem0Added += 1;
  };

  // Why: Mem0-ranked hits first (clearer relevance), then existing Hermes curated.
  const ranked = [...(mem0Hits || [])].sort((a, b) => (b.score || 0) - (a.score || 0));
  for (const hit of ranked) push(hit.memory, true);
  for (const c of curated || []) push(c, false);

  return { contents: out, mem0Added };
}
