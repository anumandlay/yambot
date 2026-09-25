/**
 * @fileoverview Current date/time line for worker LLM prompts.
 * Purpose: Same clock stamp as the API so browser-agent turns know “now”.
 * Downstream: worker/src/llm.js.
 */

/**
 * @param {Date} [now]
 * @returns {string}
 */
export function formatCurrentDateTimeForPrompt(now = new Date()) {
  const d = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const iso = d.toISOString();
  const utc = d.toLocaleString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
  return (
    `CURRENT DATE/TIME: ${utc} (ISO ${iso}). ` +
    `Treat this as “now” for today/tomorrow/this week and any relative dates.`
  );
}

/**
 * @param {object[]} messages
 * @param {Date} [now]
 * @returns {object[]}
 */
export function withCurrentDateTimeInMessages(messages, now = new Date()) {
  const line = formatCurrentDateTimeForPrompt(now);
  const list = Array.isArray(messages)
    ? messages.map((m) => (m && typeof m === "object" ? { ...m } : m))
    : [];
  const stripOldClock = (text) =>
    String(text || "").replace(/^CURRENT DATE\/TIME:[^\n]*(?:\n\n|\n)?/m, "");
  const sysIdx = list.findIndex((m) => m && m.role === "system");
  if (sysIdx >= 0) {
    const prev = list[sysIdx];
    const rest = stripOldClock(prev.content);
    list[sysIdx] = {
      ...prev,
      content: rest ? `${line}\n\n${rest}` : line,
    };
    return list;
  }
  list.unshift({ role: "system", content: line });
  return list;
}
