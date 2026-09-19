/**
 * @fileoverview Hermes-style curated memory (USER + MEMORY) on Mongo.
 * Purpose: Bounded §-delimited entry stores with threat scan, hard char caps,
 * per-entry timestamps, and frozen prompt blocks captured at task enqueue.
 * Downstream: User/Agent models, enqueueTask snapshot, worker/API memory tool, Settings + Agent Memory UI.
 */

/** Entry delimiter — same as Hermes MemoryStore (`\n§\n`). */
export const ENTRY_DELIMITER = "\n§\n";

/** Agent MEMORY.md equivalent (~7k tokens). */
export const MEMORY_CHAR_LIMIT = 20000;

/** Account USER.md equivalent (~500 tokens). */
export const USER_CHAR_LIMIT = 1375;

/** @type {readonly [RegExp, string][]} */
const MEMORY_THREAT_PATTERNS = [
  [/ignore\s+(previous|all|above|prior)\s+instructions/i, "prompt_injection"],
  [/you\s+are\s+now\s+/i, "role_hijack"],
  [/do\s+not\s+tell\s+the\s+user/i, "deception_hide"],
  [/system\s+prompt\s+override/i, "sys_prompt_override"],
  [/disregard\s+(your|all|any)\s+(instructions|rules|guidelines)/i, "disregard_rules"],
  [
    /act\s+as\s+(if|though)\s+you\s+(have\s+no|don't\s+have)\s+(restrictions|limits|rules)/i,
    "bypass_restrictions",
  ],
  [/curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, "exfil_curl"],
  [/wget\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, "exfil_wget"],
  [/cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)/i, "read_secrets"],
  [/authorized_keys/i, "ssh_backdoor"],
  [/\$HOME\/\.ssh|~\/\.ssh/i, "ssh_access"],
];

const INVISIBLE_CHARS = new Set([
  "\u200b",
  "\u200c",
  "\u200d",
  "\u2060",
  "\ufeff",
  "\u202a",
  "\u202b",
  "\u202c",
  "\u202d",
  "\u202e",
]);

/**
 * @param {string} content
 * @returns {string|null} Error message when blocked.
 */
export function scanMemoryContent(content) {
  const text = String(content || "");
  for (const char of text) {
    if (INVISIBLE_CHARS.has(char)) {
      return `Blocked: content contains invisible unicode character U+${char
        .codePointAt(0)
        .toString(16)
        .toUpperCase()
        .padStart(4, "0")} (possible injection).`;
    }
  }
  for (const [pattern, pid] of MEMORY_THREAT_PATTERNS) {
    if (pattern.test(text)) {
      return `Blocked: content matches threat pattern '${pid}'. Memory entries are injected into the system prompt and must not contain injection or exfiltration payloads.`;
    }
  }
  return null;
}

/**
 * Normalize raw Mongo / API entries into `{ content, at }` records.
 * Why: legacy stores were plain strings; new writes stamp `at` for History UI.
 * @param {unknown[]|undefined|null} entries
 * @returns {{ content: string, at: Date|null }[]}
 */
export function normalizeEntryRecords(entries) {
  if (!Array.isArray(entries)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of entries) {
    let content = "";
    /** @type {Date|null} */
    let at = null;
    if (typeof raw === "string") {
      content = raw.trim();
    } else if (raw && typeof raw === "object") {
      content = String(raw.content || raw.text || "").trim();
      if (raw.at) {
        const d = new Date(raw.at);
        at = Number.isNaN(d.getTime()) ? null : d;
      }
    }
    if (!content || seen.has(content)) continue;
    seen.add(content);
    out.push({ content, at });
  }
  return out;
}

/**
 * Content-only list for prompts / char caps (Hermes § join).
 * @param {unknown[]|undefined|null} entries
 * @returns {string[]}
 */
export function normalizeEntries(entries) {
  return normalizeEntryRecords(entries).map((e) => e.content);
}

/**
 * @param {unknown[]|undefined|null} entries
 * @returns {number}
 */
export function charCount(entries) {
  const list = normalizeEntries(entries);
  if (!list.length) return 0;
  return list.join(ENTRY_DELIMITER).length;
}

/**
 * @param {"user"|"memory"} target
 * @returns {number}
 */
export function charLimitFor(target) {
  return target === "user" ? USER_CHAR_LIMIT : MEMORY_CHAR_LIMIT;
}

/**
 * @param {number} current
 * @param {number} limit
 * @returns {string}
 */
export function usageLabel(current, limit) {
  const pct = limit > 0 ? Math.floor((current / limit) * 100) : 0;
  return `${pct}% — ${current.toLocaleString()}/${limit.toLocaleString()} chars`;
}

/**
 * Frozen system-prompt block (Hermes `_render_block`).
 * @param {"user"|"memory"} target
 * @param {unknown[]|undefined|null} entries
 * @returns {string}
 */
export function renderCuratedBlock(target, entries) {
  const list = normalizeEntries(entries);
  if (!list.length) return "";
  const limit = charLimitFor(target);
  const content = list.join(ENTRY_DELIMITER);
  const current = content.length;
  const pct = limit > 0 ? Math.floor((current / limit) * 100) : 0;
  const header =
    target === "user"
      ? `USER PROFILE (who the user is) [${pct}% — ${current.toLocaleString()}/${limit.toLocaleString()} chars]`
      : `MEMORY (your personal notes) [${pct}% — ${current.toLocaleString()}/${limit.toLocaleString()} chars]`;
  const separator = "═".repeat(46);
  return `${separator}\n${header}\n${separator}\n${content}`;
}

/**
 * Persistable record shape (content + when added/updated).
 * @param {{ content: string, at: Date|null }[]} records
 * @returns {{ content: string, at: Date|null }[]}
 */
export function toPersistableEntries(records) {
  return normalizeEntryRecords(records).map((r) => ({
    content: r.content,
    at: r.at || null,
  }));
}

/**
 * Public API/UI shape for one store.
 * @param {unknown[]|undefined|null} entries
 * @param {number} limit
 * @param {Date|string|null} [updatedAt]
 * @returns {{
 *   entries: string[],
 *   items: { content: string, at: string|null }[],
 *   charCount: number,
 *   charLimit: number,
 *   usage: string,
 *   entryCount: number,
 *   updatedAt: string|null,
 * }}
 */
export function publicCuratedStore(entries, limit, updatedAt = null) {
  const records = normalizeEntryRecords(entries);
  const list = records.map((r) => r.content);
  const current = charCount(list);
  /** @type {Date|null} */
  let storeUpdated = null;
  if (updatedAt) {
    const d = new Date(updatedAt);
    if (!Number.isNaN(d.getTime())) storeUpdated = d;
  }
  return {
    entries: list,
    items: records.map((r) => ({
      content: r.content,
      at: r.at ? r.at.toISOString() : null,
    })),
    charCount: current,
    charLimit: limit,
    usage: usageLabel(current, limit),
    entryCount: list.length,
    updatedAt: storeUpdated ? storeUpdated.toISOString() : null,
  };
}

/**
 * @param {unknown[]|undefined|null} entries
 * @param {string} content
 * @param {number} limit
 * @returns {object}
 */
export function addCuratedEntry(entries, content, limit) {
  const text = String(content || "").trim();
  if (!text) return { success: false, error: "Content cannot be empty." };
  const scanError = scanMemoryContent(text);
  if (scanError) return { success: false, error: scanError };

  const list = normalizeEntryRecords(entries);
  if (list.some((e) => e.content === text)) {
    return successPayload(list, limit, "Entry already exists (no duplicate added).");
  }

  const next = [...list, { content: text, at: new Date() }];
  const newTotal = charCount(next);
  if (newTotal > limit) {
    const current = charCount(list);
    return {
      success: false,
      error: `Memory at ${current.toLocaleString()}/${limit.toLocaleString()} chars. Adding this entry (${text.length} chars) would exceed the limit. Replace or remove existing entries first.`,
      current_entries: list.map((e) => e.content),
      usage: usageLabel(current, limit),
    };
  }
  return successPayload(next, limit, "Entry added.");
}

/**
 * @param {unknown[]|undefined|null} entries
 * @param {string} oldText
 * @param {string} newContent
 * @param {number} limit
 * @returns {object}
 */
export function replaceCuratedEntry(entries, oldText, newContent, limit) {
  const needle = String(oldText || "").trim();
  const text = String(newContent || "").trim();
  if (!needle) return { success: false, error: "old_text cannot be empty." };
  if (!text) {
    return {
      success: false,
      error: "new_content cannot be empty. Use 'remove' to delete entries.",
    };
  }
  const scanError = scanMemoryContent(text);
  if (scanError) return { success: false, error: scanError };

  const list = normalizeEntryRecords(entries);
  const matches = list
    .map((e, i) => (e.content.includes(needle) ? { i, e } : null))
    .filter(Boolean);

  if (!matches.length) {
    return { success: false, error: `No entry matched '${needle}'.` };
  }
  if (matches.length > 1) {
    const unique = new Set(matches.map((m) => m.e.content));
    if (unique.size > 1) {
      return {
        success: false,
        error: `Multiple entries matched '${needle}'. Be more specific.`,
        matches: matches.map((m) =>
          m.e.content.length > 80 ? `${m.e.content.slice(0, 80)}...` : m.e.content
        ),
      };
    }
  }

  const idx = matches[0].i;
  const next = [...list];
  next[idx] = { content: text, at: new Date() };
  const newTotal = charCount(next);
  if (newTotal > limit) {
    return {
      success: false,
      error: `Replacement would put memory at ${newTotal.toLocaleString()}/${limit.toLocaleString()} chars. Shorten the new content or remove other entries first.`,
    };
  }
  return successPayload(next, limit, "Entry replaced.");
}

/**
 * @param {unknown[]|undefined|null} entries
 * @param {string} oldText
 * @param {number} limit
 * @returns {object}
 */
export function removeCuratedEntry(entries, oldText, limit) {
  const needle = String(oldText || "").trim();
  if (!needle) return { success: false, error: "old_text cannot be empty." };

  const list = normalizeEntryRecords(entries);
  const matches = list
    .map((e, i) => (e.content.includes(needle) ? { i, e } : null))
    .filter(Boolean);

  if (!matches.length) {
    return { success: false, error: `No entry matched '${needle}'.` };
  }
  if (matches.length > 1) {
    const unique = new Set(matches.map((m) => m.e.content));
    if (unique.size > 1) {
      return {
        success: false,
        error: `Multiple entries matched '${needle}'. Be more specific.`,
        matches: matches.map((m) =>
          m.e.content.length > 80 ? `${m.e.content.slice(0, 80)}...` : m.e.content
        ),
      };
    }
  }

  const next = [...list];
  next.splice(matches[0].i, 1);
  return successPayload(next, limit, "Entry removed.");
}

/**
 * @param {"add"|"replace"|"remove"} action
 * @param {"user"|"memory"} target
 * @param {{ content?: string, oldText?: string }} payload
 * @param {unknown[]|undefined|null} entries
 * @returns {object}
 */
export function applyCuratedMemoryAction(action, target, payload, entries) {
  if (target !== "user" && target !== "memory") {
    return {
      success: false,
      target,
      error: `Invalid target '${target}'. Use 'memory' or 'user'.`,
    };
  }
  const limit = charLimitFor(target);
  let result;
  if (action === "add") {
    result = addCuratedEntry(entries, payload.content, limit);
  } else if (action === "replace") {
    result = replaceCuratedEntry(entries, payload.oldText, payload.content, limit);
  } else if (action === "remove") {
    result = removeCuratedEntry(entries, payload.oldText, limit);
  } else {
    return {
      success: false,
      target,
      error: `Unknown action '${action}'. Use: add, replace, remove`,
    };
  }
  return { ...result, target };
}

/**
 * @param {{ content: string, at: Date|null }[]} records
 * @param {number} limit
 * @param {string} message
 */
function successPayload(records, limit, message) {
  const entries = records.map((r) => r.content);
  const current = charCount(entries);
  return {
    success: true,
    entries,
    items: records.map((r) => ({
      content: r.content,
      at: r.at ? new Date(r.at) : new Date(),
    })),
    persistable: toPersistableEntries(records),
    usage: usageLabel(current, limit),
    entryCount: entries.length,
    message,
  };
}
