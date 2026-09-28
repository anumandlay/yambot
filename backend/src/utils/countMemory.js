/**
 * @fileoverview Dated account/trial counts for prompts and day-history answers.
 * Purpose: An older “12 accounts” and today’s “5 accounts” can both be true. The newest day is current.
 * Downstream: Agent snapshot prompt, day-history chat answers.
 */

const COUNT_RE = /\b(\d{1,6})\s+(?:active\s+|india\s+|trial\s+)*(accounts?|trials?|rows?|agencies)\b/gi;

/**
 * @param {{ day?: string, text?: string }[]} entries
 * @returns {{ day: string, label: string }[]}
 */
export function collectDatedCounts(entries) {
  /** @type {{ day: string, label: string }[]} */
  const found = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const day = String(entry?.day || "").slice(0, 10);
    const text = String(entry?.text || "");
    const re = new RegExp(COUNT_RE.source, "gi");
    let match;
    while ((match = re.exec(text))) {
      found.push({ day, label: match[0].replace(/\s+/g, " ").trim() });
    }
  }
  return found;
}

/**
 * When two days mention a count, say which one is current.
 * @param {{ day?: string, text?: string }[]} entries
 * @returns {string}
 */
export function formatCurrentCountNote(entries) {
  const found = collectDatedCounts(entries).filter((row) => row.day);
  if (found.length < 2) return "";
  const days = [...new Set(found.map((row) => row.day))].sort();
  if (days.length < 2) return "";
  const newest = days[days.length - 1];
  const lines = [
    "CURRENT COUNT: use the newest dated observation. Older counts are history.",
  ];
  const seen = new Set();
  const ordered = [...found].sort((a, b) => b.day.localeCompare(a.day));
  for (const row of ordered) {
    const key = `${row.day}|${row.label.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`- ${row.day}: ${row.label} (${row.day === newest ? "current" : "older"})`);
    if (lines.length > 6) break;
  }
  return lines.join("\n");
}
