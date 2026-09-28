/**
 * @fileoverview Refuse finish on list goals until extract has read the rows.
 * Purpose: Landing on the right URL is not the result the user asked for.
 * Downstream: worker/src/agent.js finish action.
 */

/**
 * @param {string} goal
 * @returns {boolean}
 */
export function goalWantsExtractedList(goal) {
  const g = String(goal || "").toLowerCase();
  if (!/\b(list|table|extract|accounts|rows|trial)\b/.test(g)) return false;
  return /\b(get|show|give|fetch|extract|read|list|tell)\b/.test(g);
}

/**
 * @param {object[]} history
 * @returns {boolean}
 */
export function historyHasListExtract(history) {
  return (Array.isArray(history) ? history : []).some((h) => {
    if (String(h?.action?.type || "") !== "extract") return false;
    if (h?.result?.ok === false) return false;
    if (h?.result?.extracted !== true) return false;
    const snippet = String(h?.result?.snippet || h?.result?.text || "").trim();
    return snippet.length > 20;
  });
}
