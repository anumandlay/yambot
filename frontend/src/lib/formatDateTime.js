/**
 * @fileoverview Locale-aware date/time formatters for the YamBot UI.
 * Purpose: Consistent timestamps in chat and lists (always include seconds where shown).
 * Downstream: ChatDetailPage message bubbles.
 */

/**
 * Formats a message timestamp with date and time including seconds.
 * @param {string|number|Date|null|undefined} value - ISO string or Date from API `createdAt`.
 * @returns {string} Localized string, or empty when invalid/missing.
 */
export function formatChatMessageTime(value) {
  if (value == null || value === "") return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}
