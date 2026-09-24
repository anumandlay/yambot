/**
 * @fileoverview Chat-scoped session scratch (temporary facts, not durable MEMORY).
 * Purpose: Hold “for this chat / for now” notes with TTL so they never pollute USER/MEMORY.
 * Downstream: chats Auto prompt via chatContext; chatRememberPersist session path.
 */

/** Default scratch lifetime (24h). Cleared earlier if chat is deleted. */
export const SESSION_SCRATCH_TTL_MS = 24 * 60 * 60 * 1000;

/** Soft cap so scratch cannot crowd the prompt. */
export const SESSION_SCRATCH_MAX_NOTES = 12;
export const SESSION_SCRATCH_CHAR_LIMIT = 2_400;

/**
 * @param {unknown} raw
 * @returns {{ content: string, at: Date, expiresAt: Date, source: string }[]}
 */
export function normalizeScratchNotes(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.notes) ? raw.notes : [];
  const now = Date.now();
  /** @type {{ content: string, at: Date, expiresAt: Date, source: string }[]} */
  const out = [];
  const seen = new Set();
  for (const row of list) {
    const content = String(row?.content || row || "").trim();
    if (!content || content.length < 2 || seen.has(content.toLowerCase())) continue;
    const at = row?.at ? new Date(row.at) : new Date();
    const expiresAt = row?.expiresAt
      ? new Date(row.expiresAt)
      : new Date(at.getTime() + SESSION_SCRATCH_TTL_MS);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now) continue;
    seen.add(content.toLowerCase());
    out.push({
      content: content.slice(0, 400),
      at: Number.isNaN(at.getTime()) ? new Date() : at,
      expiresAt,
      source: String(row?.source || "session").slice(0, 40),
    });
  }
  return out.slice(-SESSION_SCRATCH_MAX_NOTES);
}

/**
 * @param {{ content: string, at: Date, expiresAt: Date, source: string }[]} notes
 * @returns {number}
 */
export function scratchCharCount(notes) {
  return notes.reduce((n, row) => n + String(row.content || "").length + 2, 0);
}

/**
 * Add a scratch note; returns updated notes array (expired purged).
 * @param {unknown} existing
 * @param {string} content
 * @param {{ ttlMs?: number, source?: string }} [opts]
 * @returns {{ notes: object[], added: boolean, truncated: boolean }}
 */
export function addScratchNote(existing, content, opts = {}) {
  const text = String(content || "").trim().slice(0, 400);
  if (!text) return { notes: normalizeScratchNotes(existing), added: false, truncated: false };
  const ttl = Math.max(60_000, Number(opts.ttlMs) || SESSION_SCRATCH_TTL_MS);
  const now = new Date();
  let notes = normalizeScratchNotes(existing).filter(
    (n) => n.content.toLowerCase() !== text.toLowerCase()
  );
  notes.push({
    content: text,
    at: now,
    expiresAt: new Date(now.getTime() + ttl),
    source: String(opts.source || "chat_session").slice(0, 40),
  });
  let truncated = false;
  while (notes.length > SESSION_SCRATCH_MAX_NOTES || scratchCharCount(notes) > SESSION_SCRATCH_CHAR_LIMIT) {
    if (!notes.length) break;
    notes.shift();
    truncated = true;
  }
  return { notes, added: true, truncated };
}

/**
 * Remove scratch notes matching a needle (substring, case-insensitive).
 * @param {unknown} existing
 * @param {string} needle
 * @returns {{ notes: object[], removed: string[] }}
 */
export function removeScratchNotes(existing, needle) {
  const key = String(needle || "").trim().toLowerCase();
  const notes = normalizeScratchNotes(existing);
  if (!key) return { notes, removed: [] };
  /** @type {string[]} */
  const removed = [];
  const kept = notes.filter((n) => {
    const hay = n.content.toLowerCase();
    if (hay.includes(key) || key.includes(hay)) {
      removed.push(n.content);
      return false;
    }
    return true;
  });
  return { notes: kept, removed };
}

/**
 * Prompt block for session scratch (explicitly temporary / untrusted for durable prefs).
 * @param {unknown} scratch
 * @returns {string}
 */
export function formatSessionScratchBlock(scratch) {
  const notes = normalizeScratchNotes(scratch);
  if (!notes.length) return "";
  const lines = notes.map((n, i) => `${i + 1}. ${n.content}`);
  return [
    "══════════════════════════════════════════════",
    "SESSION SCRATCH (this chat only — temporary)",
    "══════════════════════════════════════════════",
    "These notes expire and are NOT durable USER/MEMORY. Prefer the current user message. Do not treat scratch as account prefs.",
    lines.join("\n"),
  ].join("\n");
}
