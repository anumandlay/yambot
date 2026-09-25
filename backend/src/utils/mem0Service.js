/**
 * @fileoverview Self-hosted long-term memory (Mem0-style) via FastEmbed + Qdrant.
 * Purpose: Clearer fact retrieve/store than dumping Hermes USER/MEMORY alone.
 * Why: mem0ai/oss Memory pulls broken optional peers + MiniMax has no /embeddings;
 * we keep Mem0’s model (scoped facts + semantic search) with local FastEmbed on VPS Qdrant.
 * Downstream: semanticMemory resolve, curatedMemoryOps writes, chats Auto turns.
 */

import { randomUUID } from "crypto";
import { env } from "./env.js";
import { isEphemeralCuratedFact, isEphemeralListResult } from "./curatedMemoryFilter.js";
import { scanMemoryContent } from "./curatedMemory.js";
import { wrapUntrustedToolResult } from "./hermesUntrusted.js";

/** Sentinel agent_id for account-wide USER prefs. */
export const MEM0_USER_SCOPE_AGENT = "yambot_user_profile";

/** @type {import("@qdrant/js-client-rest").QdrantClient|null} */
let qdrantClient = null;
/** @type {Promise<any>|null} */
let embedderPromise = null;
/** @type {Promise<boolean>|null} */
let collectionReadyPromise = null;

/**
 * @returns {boolean}
 */
export function isMem0Enabled() {
  const flag = String(process.env.MEM0_ENABLED || env.MEM0_ENABLED || "").trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off" || flag === "no") return false;
  if (flag === "1" || flag === "true" || flag === "on" || flag === "yes") return true;
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
 * @returns {{ url: string, collection: string, dims: number, model: string }}
 */
function mem0StoreConfig() {
  return {
    url: String(process.env.MEM0_QDRANT_URL || env.MEM0_QDRANT_URL || "http://127.0.0.1:6333").trim(),
    collection: String(
      process.env.MEM0_COLLECTION || env.MEM0_COLLECTION || "yambot_memories"
    ).trim(),
    dims: Math.max(
      64,
      Number(process.env.MEM0_EMBEDDING_DIMS || env.MEM0_EMBEDDING_DIMS || 384) || 384
    ),
    model: String(
      process.env.MEM0_EMBEDDER_MODEL || env.MEM0_EMBEDDER_MODEL || "fast-bge-small-en-v1.5"
    ).trim(),
  };
}

/**
 * @returns {Promise<import("@qdrant/js-client-rest").QdrantClient|null>}
 */
async function getQdrant() {
  if (!isMem0Enabled()) return null;
  if (qdrantClient) return qdrantClient;
  const { QdrantClient } = await import("@qdrant/js-client-rest");
  const { url } = mem0StoreConfig();
  qdrantClient = new QdrantClient({ url, checkCompatibility: false });
  return qdrantClient;
}

/**
 * @returns {Promise<any|null>}
 */
async function getEmbedder() {
  if (!isMem0Enabled()) return null;
  if (embedderPromise) return embedderPromise;
  embedderPromise = (async () => {
    const { FlagEmbedding, EmbeddingModel } = await import("fastembed");
    const { model } = mem0StoreConfig();
    const modelId =
      model === "fast-bge-small-en-v1.5" || !model
        ? EmbeddingModel.BGESmallENV15
        : Object.values(EmbeddingModel).includes(model)
          ? model
          : EmbeddingModel.BGESmallENV15;
    const emb = await FlagEmbedding.init({ model: modelId });
    console.log(`[mem0] FastEmbed ready · model=${modelId}`);
    return emb;
  })().catch((err) => {
    console.warn("[mem0] FastEmbed init failed:", err?.message || err);
    embedderPromise = null;
    return null;
  });
  return embedderPromise;
}

/**
 * @param {string} text
 * @returns {Promise<number[]|null>}
 */
async function embedText(text) {
  const emb = await getEmbedder();
  if (!emb) return null;
  const t = String(text || "").trim();
  if (!t) return null;
  try {
    const iter = emb.embed([t]);
    for await (const batch of iter) {
      const row = batch?.[0];
      // Why: FastEmbed yields Float32Array rows; Array.isArray is false for typed arrays.
      if (row == null) continue;
      const nums = Array.from(row, (n) => Number(n)).filter((n) => Number.isFinite(n));
      if (nums.length) return nums;
    }
  } catch (err) {
    console.warn("[mem0] embed failed:", err?.message || err);
  }
  return null;
}

/**
 * @returns {Promise<boolean>}
 */
async function ensureCollection() {
  if (collectionReadyPromise) return collectionReadyPromise;
  collectionReadyPromise = (async () => {
    const client = await getQdrant();
    if (!client) return false;
    const { collection, dims } = mem0StoreConfig();
    try {
      const existing = await client.getCollections();
      const names = (existing?.collections || []).map((c) => c.name);
      if (!names.includes(collection)) {
        await client.createCollection(collection, {
          vectors: { size: dims, distance: "Cosine" },
        });
        console.log(`[mem0] created Qdrant collection ${collection} · dims=${dims}`);
      }
      return true;
    } catch (err) {
      console.warn("[mem0] ensureCollection failed:", err?.message || err);
      collectionReadyPromise = null;
      return false;
    }
  })();
  return collectionReadyPromise;
}

/**
 * Compatibility shim — older code awaited getMem0Memory(); now returns truthy when store is ready.
 * @param {{ userId?: string|null }} [opts]
 * @returns {Promise<object|null>}
 */
export async function getMem0Memory(opts = {}) {
  if (!isMem0Enabled()) return null;
  const ok = await ensureCollection();
  if (!ok) return null;
  const emb = await getEmbedder();
  if (!emb) return null;
  return { ok: true, userId: opts.userId || null };
}

/**
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
  if (!(await ensureCollection())) return [];
  const client = await getQdrant();
  if (!client) return [];

  const scope = opts.scope === "user" ? "user" : "agent";
  const agentKey =
    scope === "user" ? MEM0_USER_SCOPE_AGENT : mem0AgentKey(opts.agentId);
  if (!agentKey) return [];

  const vector = await embedText(query);
  if (!vector) return [];

  const { collection } = mem0StoreConfig();
  const topK = Math.min(20, Math.max(1, Number(opts.topK) || 8));
  const threshold = Number.isFinite(Number(opts.threshold)) ? Number(opts.threshold) : 0.15;

  try {
    const hits = await client.search(collection, {
      vector,
      limit: topK,
      with_payload: true,
      score_threshold: threshold,
      filter: {
        must: [
          { key: "user_id", match: { value: userKey } },
          { key: "agent_id", match: { value: agentKey } },
        ],
      },
    });
    return normalizeMem0SearchResults({
      results: (hits || []).map((h) => ({
        id: h.id,
        memory: h.payload?.memory || h.payload?.data || "",
        score: h.score,
      })),
    });
  } catch (err) {
    console.warn("[mem0] search failed:", err?.message || err);
    return [];
  }
}

/**
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
  // Why: Mem0 hits are injected into the system prompt — same threat gate as curated Mongo writes.
  const scanError = scanMemoryContent(content);
  if (scanError) return { ok: false, skipped: "threat" };
  if (!(await ensureCollection())) return { ok: false, skipped: "disabled" };

  const scope = opts.scope === "user" ? "user" : "agent";
  const agentKey =
    scope === "user" ? MEM0_USER_SCOPE_AGENT : mem0AgentKey(opts.agentId);
  if (!agentKey) return { ok: false, skipped: "no_agent" };

  // Why: never insert the same fact twice (remember + ingest + cron used to stack copies).
  try {
    const { normalizeFactKey } = await import("./curatedMemory.js");
    const key = normalizeFactKey(content);
    if (key.length >= 8) {
      const existing = await mem0ListFacts({
        userId: opts.userId,
        scope,
        agentId: opts.agentId,
        limit: 80,
      });
      const dup = existing.some((row) => {
        const other = normalizeFactKey(row.content);
        if (!other) return false;
        if (other === key) return true;
        if (key.length >= 12 && other.length >= 12) {
          return key.includes(other) || other.includes(key);
        }
        return false;
      });
      if (dup) return { ok: false, skipped: "duplicate" };
    }
  } catch {
    /* ignore list failures — still try to add */
  }

  const vector = await embedText(content);
  if (!vector) return { ok: false, skipped: "embed_failed" };

  const client = await getQdrant();
  if (!client) return { ok: false, skipped: "disabled" };
  const { collection } = mem0StoreConfig();
  const id = randomUUID();

  try {
    await client.upsert(collection, {
      wait: true,
      points: [
        {
          id,
          vector,
          payload: {
            memory: content,
            data: content,
            user_id: userKey,
            agent_id: agentKey,
            scope,
            source: "yambot_mem0",
            created_at: new Date().toISOString(),
            ...(opts.metadata && typeof opts.metadata === "object" ? opts.metadata : {}),
          },
        },
      ],
    });
    // Why: chat/cron dirty check — skip when the summarizer itself wrote the fact.
    const src = String(opts.metadata?.source || "");
    if (scope === "agent" && opts.agentId && src !== "memory_summarize_cron") {
      try {
        const { markAgentMemoryContentChangedById } = await import("../models/Agent.js");
        await markAgentMemoryContentChangedById(opts.agentId);
      } catch {
        /* ignore */
      }
    }
    return { ok: true };
  } catch (err) {
    console.warn("[mem0] addFact failed:", err?.message || err);
    return { ok: false, skipped: "error" };
  }
}

/**
 * List Mem0 facts for a user scope (USER profile or one agent).
 * Why: Settings → Memory only showed Mongo curated; chip USER prefs can be Mem0-only.
 * @param {{
 *   userId: string,
 *   scope?: "user"|"agent",
 *   agentId?: string|null,
 *   limit?: number,
 * }} opts
 * @returns {Promise<{ id: string, content: string, createdAt: string|null, source: string }[]>}
 */
export async function mem0ListFacts(opts) {
  const userKey = mem0UserKey(opts.userId);
  if (!userKey) return [];
  if (!(await ensureCollection())) return [];
  const client = await getQdrant();
  if (!client) return [];

  const scope = opts.scope === "agent" ? "agent" : "user";
  const agentKey =
    scope === "user" ? MEM0_USER_SCOPE_AGENT : mem0AgentKey(opts.agentId);
  if (!agentKey) return [];

  const { collection } = mem0StoreConfig();
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 100));

  try {
    /** @type {{ id: string, content: string, createdAt: string|null, source: string }[]} */
    const out = [];
    let offset = null;
    // Why: scroll pages until we hit limit or exhausted.
    for (let page = 0; page < 20 && out.length < limit; page++) {
      const res = await client.scroll(collection, {
        limit: Math.min(64, limit - out.length),
        offset: offset || undefined,
        with_payload: true,
        with_vector: false,
        filter: {
          must: [
            { key: "user_id", match: { value: userKey } },
            { key: "agent_id", match: { value: agentKey } },
          ],
        },
      });
      const points = Array.isArray(res?.points) ? res.points : [];
      for (const p of points) {
        const content = String(p.payload?.memory || p.payload?.data || "").trim();
        if (!content) continue;
        out.push({
          id: String(p.id),
          content,
          createdAt: p.payload?.created_at ? String(p.payload.created_at) : null,
          source: String(p.payload?.source || "mem0"),
        });
      }
      offset = res?.next_page_offset;
      if (offset == null || !points.length) break;
    }
    return out;
  } catch (err) {
    console.warn("[mem0] listFacts failed:", err?.message || err);
    return [];
  }
}

/**
 * Delete one Mem0 point (must belong to this user).
 * @param {{ userId: string, id: string }} opts
 * @returns {Promise<{ ok: boolean, skipped?: string }>}
 */
export async function mem0DeleteFact(opts) {
  const userKey = mem0UserKey(opts.userId);
  const id = String(opts.id || "").trim();
  if (!userKey || !id) return { ok: false, skipped: "missing" };
  if (!(await ensureCollection())) return { ok: false, skipped: "disabled" };
  const client = await getQdrant();
  if (!client) return { ok: false, skipped: "disabled" };
  const { collection } = mem0StoreConfig();

  try {
    const existing = await client.retrieve(collection, {
      ids: [id],
      with_payload: true,
      with_vector: false,
    });
    const point = Array.isArray(existing) ? existing[0] : null;
    if (!point) return { ok: false, skipped: "not_found" };
    if (String(point.payload?.user_id || "") !== userKey) {
      return { ok: false, skipped: "forbidden" };
    }
    await client.delete(collection, { wait: true, points: [id] });
    return { ok: true };
  } catch (err) {
    console.warn("[mem0] deleteFact failed:", err?.message || err);
    return { ok: false, skipped: "error" };
  }
}

/**
 * Clear all Mem0 facts for USER profile or one agent.
 * @param {{
 *   userId: string,
 *   scope?: "user"|"agent",
 *   agentId?: string|null,
 * }} opts
 * @returns {Promise<{ ok: boolean, deleted?: number, skipped?: string }>}
 */
export async function mem0ClearScope(opts) {
  const userKey = mem0UserKey(opts.userId);
  if (!userKey) return { ok: false, skipped: "missing" };
  if (!(await ensureCollection())) return { ok: false, skipped: "disabled" };
  const client = await getQdrant();
  if (!client) return { ok: false, skipped: "disabled" };

  const scope = opts.scope === "agent" ? "agent" : "user";
  const agentKey =
    scope === "user" ? MEM0_USER_SCOPE_AGENT : mem0AgentKey(opts.agentId);
  if (!agentKey) return { ok: false, skipped: "no_agent" };

  const { collection } = mem0StoreConfig();
  try {
    await client.delete(collection, {
      wait: true,
      filter: {
        must: [
          { key: "user_id", match: { value: userKey } },
          { key: "agent_id", match: { value: agentKey } },
        ],
      },
    });
    return { ok: true, deleted: -1 };
  } catch (err) {
    console.warn("[mem0] clearScope failed:", err?.message || err);
    return { ok: false, skipped: "error" };
  }
}

/**
 * Delete Mem0 points whose content matches (exact / contains) a needle.
 * Why: Mongo remove must mirror into Qdrant so forgotten facts cannot be re-injected.
 * @param {{
 *   userId: string,
 *   scope?: "user"|"agent",
 *   agentId?: string|null,
 *   content: string,
 * }} opts
 * @returns {Promise<{ ok: boolean, deleted?: number, skipped?: string }>}
 */
export async function mem0DeleteByContent(opts) {
  const needle = String(opts.content || "").trim().toLowerCase();
  const userId = String(opts.userId || "").trim();
  if (!needle || !userId) return { ok: false, skipped: "missing" };
  const scope = opts.scope === "agent" ? "agent" : "user";
  const listed = await mem0ListFacts({
    userId,
    scope,
    agentId: opts.agentId,
    limit: 200,
  });
  let deleted = 0;
  for (const row of listed) {
    const hay = String(row.content || "").trim().toLowerCase();
    if (!hay) continue;
    if (hay === needle || hay.includes(needle) || (needle.length >= 12 && needle.includes(hay))) {
      const r = await mem0DeleteFact({ userId, id: row.id });
      if (r.ok) deleted += 1;
    }
  }
  return { ok: true, deleted };
}

/**
 * Extract durable facts from a chat turn via the user's Settings LLM, then store them.
 * @param {{
 *   userId: string,
 *   agentId?: string|null,
 *   userText: string,
 *   assistantText: string,
 * }} opts
 * @returns {Promise<{ ok: boolean, skipped?: string, saved?: number }>}
 */
export async function mem0IngestChatTurn(opts) {
  const userText = String(opts.userText || "").trim();
  const assistantText = String(opts.assistantText || "").trim();
  const userId = String(opts.userId || "").trim();
  const agentId = String(opts.agentId || "").trim();
  if (!userId || !agentId) return { ok: false, skipped: "missing" };
  if (!userText || userText.length < 2) return { ok: false, skipped: "short" };
  if (/^(hi|hello|hey|ok|okay|thanks|thank you|yo|sup)[.!\s]*$/i.test(userText)) {
    return { ok: false, skipped: "greeting" };
  }
  // Why: “remember …” already wrote Mem0 once — don’t re-extract the same fact.
  try {
    const { looksLikeMemoryStoreRequest, looksLikeMemoryForgetRequest } = await import(
      "./messageIntent.js"
    );
    if (looksLikeMemoryStoreRequest(userText) || looksLikeMemoryForgetRequest(userText)) {
      return { ok: true, skipped: "remember_or_forget", saved: 0 };
    }
  } catch {
    /* ignore */
  }
  // Why: list/fetch answers already shown in chat must not land in Mem0.
  if (
    isEphemeralListResult({
      goal: userText,
      summary: assistantText,
    })
  ) {
    return { ok: true, skipped: "ephemeral_list", saved: 0 };
  }
  if (!(await ensureCollection())) return { ok: false, skipped: "disabled" };

  /** @type {string[]} */
  let facts = [];
  try {
    const { User } = await import("../models/User.js");
    const { resolveLlmCredentials } = await import("./llmCredentials.js");
    const { llmChatCompletion } = await import("./llmChat.js");
    const user = await User.findById(userId);
    const creds = user ? await resolveLlmCredentials(user) : null;
    if (creds?.apiKey) {
      const raw = await llmChatCompletion({
        apiKey: creds.apiKey,
        baseUrl: creds.llmBaseUrl || "",
        model: creds.llmModel || "",
        temperature: 0.1,
        maxTokens: 400,
        messages: [
          {
            role: "system",
            content:
              'Extract 0-3 durable facts about the user or their work from this chat. Return ONLY JSON {"facts":["..."]}. Skip greetings, one-off tasks, if/then rules, and secrets.',
          },
          {
            role: "user",
            content: `USER:\n${userText.slice(0, 2000)}\n\nASSISTANT:\n${assistantText.slice(0, 2000)}`,
          },
        ],
      });
      try {
        const brace = String(raw || "").match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(brace ? brace[0] : raw);
/**
 * Also filter facts after LLM extract with threat scan.
 */
        facts = (Array.isArray(parsed?.facts) ? parsed.facts : [])
          .map((f) => String(f || "").trim())
          .filter(
            (f) =>
              f.length >= 8 &&
              f.length <= 320 &&
              !isEphemeralCuratedFact(f) &&
              !scanMemoryContent(f)
          );
      } catch {
        facts = [];
      }
    }
  } catch (err) {
    console.warn("[mem0] ingest extract failed:", err?.message || err);
  }

  if (!facts.length) return { ok: true, skipped: "none", saved: 0 };

  /** @param {string} text */
  const looksPersonal = (text) =>
    /\b(i\s+(have|own|am|'m)|my\s+(name|car|email|phone|timezone|tz|preference|prefer))\b/i.test(
      String(text || "")
    ) ||
    /\b(user prefers|user owns|user's name)\b/i.test(String(text || ""));

  let saved = 0;
  for (const content of facts) {
    if (scanMemoryContent(content)) continue;
    if (isEphemeralCuratedFact(content)) continue;
    const personal = looksPersonal(content) || looksPersonal(userText);
    const scope = personal ? "user" : "agent";
    const r = await mem0AddFact({
      userId,
      agentId: personal ? null : agentId,
      scope,
      content,
      metadata: { source: "yambot_chat" },
    });
    if (r.ok) saved += 1;
  }
  return { ok: true, saved };
}

/**
 * @param {string[]} curated
 * @param {{ memory: string, score: number }[]} mem0Hits
 * @param {number} charLimit
 * @returns {{
 *   contents: string[],
 *   mem0Added: number,
 *   trusted: string[],
 *   untrusted: string[],
 * }}
 */
export function mergeMem0IntoCurated(curated, mem0Hits, charLimit) {
  const limit = Math.max(200, Number(charLimit) || 8000);
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const trusted = [];
  /** @type {string[]} */
  const untrusted = [];
  const seen = new Set();
  let chars = 0;
  let mem0Added = 0;

  const push = (text, fromMem0) => {
    const t = String(text || "").trim();
    if (!t || isEphemeralCuratedFact(t)) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    // Why: Mem0 / external retrieval is labeled + delimited (Hermes Phase 3) so it cannot masquerade as system rules.
    const labeled = fromMem0
      ? wrapUntrustedToolResult(`[untrusted·retrieved] ${t}`)
      : t;
    if (chars + labeled.length > limit && out.length) return;
    seen.add(key);
    out.push(labeled);
    chars += labeled.length + 2;
    if (fromMem0) {
      mem0Added += 1;
      untrusted.push(t);
    } else {
      trusted.push(t);
    }
  };

  const ranked = [...(mem0Hits || [])].sort((a, b) => (b.score || 0) - (a.score || 0));
  for (const hit of ranked) push(hit.memory, true);
  for (const c of curated || []) push(c, false);

  return { contents: out, mem0Added, trusted, untrusted };
}
