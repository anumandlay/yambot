/**
 * @fileoverview Hermes-style curated memory (USER + MEMORY) on Mongo.
 * Purpose: Bounded §-delimited entry stores with threat scan, hard char caps,
 * and frozen prompt blocks captured at task enqueue (session start).
 * Downstream: User/Agent models, enqueueTask snapshot, worker/API memory tool, Settings + Agent Memory UI.
 */

/** Entry delimiter — same as Hermes MemoryStore (`\n§\n`). */
export const ENTRY_DELIMITER = "\n§\n";

/** Agent MEMORY.md equivalent (~800 tokens). */
export const MEMORY_CHAR_LIMIT = 2200;

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
 * @param {string[]|undefined|null} entries
 * @returns {string[]}
 */
export function normalizeEntries(entries) {
  if (!Array.isArray(entries)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of entries) {
    const e = String(raw || "").trim();
    if (!e || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

/**
 * @param {string[]|undefined|null} entries
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
 * @param {string[]|undefined|null} entries
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
 * Public API/UI shape for one store.
 * @param {string[]|undefined|null} entries
 * @param {number} limit
 * @returns {{ entries: string[], charCount: number, charLimit: number, usage: string, entryCount: number }}
 */
export function publicCuratedStore(entries, limit) {
  const list = normalizeEntries(entries);
  const current = charCount(list);
  return {
    entries: list,
    charCount: current,
    charLimit: limit,
    usage: usageLabel(current, limit),
    entryCount: list.length,
  };
}

/**
 * @param {string[]|undefined|null} entries
 * @param {string} content
 * @param {number} limit
 * @returns {{ success: boolean, entries?: string[], error?: string, message?: string, usage?: string, entryCount?: number, current_entries?: string[] }}
 */
export function addCuratedEntry(entries, content, limit) {
  const text = String(content || "").trim();
  if (!text) return { success: false, error: "Content cannot be empty." };
  const scanError = scanMemoryContent(text);
  if (scanError) return { success: false, error: scanError };

  const list = normalizeEntries(entries);
  if (list.includes(text)) {
    return successPayload(list, limit, "Entry already exists (no duplicate added).");
  }

  const next = [...list, text];
  const newTotal = charCount(next);
  if (newTotal > limit) {
    const current = charCount(list);
    return {
      success: false,
      error: `Memory at ${current.toLocaleString()}/${limit.toLocaleString()} chars. Adding this entry (${text.length} chars) would exceed the limit. Replace or remove existing entries first.`,
      current_entries: list,
      usage: usageLabel(current, limit),
    };
  }
  return successPayload(next, limit, "Entry added.");
}

/**
 * @param {string[]|undefined|null} entries
 * @param {string} oldText
 * @param {string} newContent
 * @param {number} limit
 * @returns {{ success: boolean, entries?: string[], error?: string, message?: string, usage?: string, entryCount?: number, matches?: string[] }}
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

  const list = normalizeEntries(entries);
  const matches = list
    .map((e, i) => (e.includes(needle) ? { i, e } : null))
    .filter(Boolean);

  if (!matches.length) {
    return { success: false, error: `No entry matched '${needle}'.` };
  }
  if (matches.length > 1) {
    const unique = new Set(matches.map((m) => m.e));
    if (unique.size > 1) {
      return {
        success: false,
        error: `Multiple entries matched '${needle}'. Be more specific.`,
        matches: matches.map((m) =>
          m.e.length > 80 ? `${m.e.slice(0, 80)}...` : m.e
        ),
      };
    }
  }

  const idx = matches[0].i;
  const next = [...list];
  next[idx] = text;
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
 * @param {string[]|undefined|null} entries
 * @param {string} oldText
 * @param {number} limit
 * @returns {{ success: boolean, entries?: string[], error?: string, message?: string, usage?: string, entryCount?: number, matches?: string[] }}
 */
export function removeCuratedEntry(entries, oldText, limit) {
  const needle = String(oldText || "").trim();
  if (!needle) return { success: false, error: "old_text cannot be empty." };

  const list = normalizeEntries(entries);
  const matches = list
    .map((e, i) => (e.includes(needle) ? { i, e } : null))
    .filter(Boolean);

  if (!matches.length) {
    return { success: false, error: `No entry matched '${needle}'.` };
  }
  if (matches.length > 1) {
    const unique = new Set(matches.map((m) => m.e));
    if (unique.size > 1) {
      return {
        success: false,
        error: `Multiple entries matched '${needle}'. Be more specific.`,
        matches: matches.map((m) =>
          m.e.length > 80 ? `${m.e.slice(0, 80)}...` : m.e
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
 * @param {string[]|undefined|null} entries
 * @returns {{ success: boolean, target: string, entries?: string[], error?: string, message?: string, usage?: string, entryCount?: number, matches?: string[], current_entries?: string[] }}
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
 * @param {string[]} entries
 * @param {number} limit
 * @param {string} message
 */
function successPayload(entries, limit, message) {
  const current = charCount(entries);
  return {
    success: true,
    entries,
    usage: usageLabel(current, limit),
    entryCount: entries.length,
    message,
  };
}
