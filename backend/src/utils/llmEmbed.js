/**
 * @fileoverview OpenAI-compatible text embeddings for semantic memory retrieval.
 * Purpose: Vectorize curated memory entries + goals so YamBot can inject top-k facts.
 * Downstream: semanticMemory.js (built-in retrieval); falls back silently when unsupported.
 */

import { buildLlmAuthHeaders, normalizeApiKey } from "./llmDefaults.js";
import { isOpenAiCodexBaseUrl } from "./openaiCodex.js";

/** Default embedding model for OpenAI-compatible `/embeddings`. */
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * @param {string} baseUrl
 * @returns {boolean}
 */
export function embeddingsSupported(baseUrl) {
  const root = String(baseUrl || "").replace(/\/$/, "");
  if (!root) return false;
  // Why: Codex / Anthropic chat endpoints are not OpenAI embeddings-compatible.
  if (isOpenAiCodexBaseUrl(root)) return false;
  if (/anthropic\.com/i.test(root)) return false;
  return true;
}

/**
 * Embed one or more texts via `{baseUrl}/embeddings`.
 * @param {{
 *   apiKey: string,
 *   baseUrl: string,
 *   texts: string[],
 *   model?: string,
 *   timeoutMs?: number,
 * }} opts
 * @returns {Promise<(number[]|null)[]>} One vector per input (null on per-row failure).
 */
export async function embedTexts(opts) {
  const texts = (opts.texts || []).map((t) => String(t || "").trim());
  if (!texts.length) return [];
  const root = String(opts.baseUrl || "").replace(/\/$/, "");
  const key = normalizeApiKey(opts.apiKey);
  if (!key || !embeddingsSupported(root)) {
    return texts.map(() => null);
  }

  const model = String(opts.model || DEFAULT_EMBEDDING_MODEL).trim() || DEFAULT_EMBEDDING_MODEL;
  const timeoutMs = Math.max(5_000, Number(opts.timeoutMs) || 20_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${root}/embeddings`, {
      method: "POST",
      headers: buildLlmAuthHeaders({ apiKey: key, baseUrl: root }),
      body: JSON.stringify({ model, input: texts }),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      console.warn(
        `[llmEmbed] ${response.status} ${String(raw || "").slice(0, 200)}`
      );
      return texts.map(() => null);
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return texts.map(() => null);
    }
    const rows = Array.isArray(data?.data) ? data.data : [];
    /** @type {(number[]|null)[]} */
    const out = texts.map(() => null);
    for (const row of rows) {
      const idx = Number(row?.index);
      const emb = row?.embedding;
      if (!Number.isInteger(idx) || idx < 0 || idx >= out.length) continue;
      if (!Array.isArray(emb) || !emb.length) continue;
      out[idx] = emb.map((n) => Number(n)).filter((n) => Number.isFinite(n));
    }
    return out;
  } catch (err) {
    console.warn("[llmEmbed] failed:", err?.message || err);
    return texts.map(() => null);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{ apiKey?: string, llmBaseUrl?: string, baseUrl?: string }} creds
 * @param {string} text
 * @returns {Promise<number[]|null>}
 */
export async function embedOne(creds, text) {
  const [v] = await embedTexts({
    apiKey: creds?.apiKey || "",
    baseUrl: creds?.llmBaseUrl || creds?.baseUrl || "",
    texts: [String(text || "")],
  });
  return v || null;
}
