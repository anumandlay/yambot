/**
 * @fileoverview Copy naming helper — suffix duplicate entities with date/time.
 * Purpose: Agent/goal copy endpoints produce editable names like "CRM Bot copy 2026-08-26 18:40".
 * Downstream: agents.js, goals.js copy routes.
 */

/**
 * @param {string} baseName
 * @param {Date} [at]
 * @returns {string}
 */
export function copyNameWithTimestamp(baseName, at = new Date()) {
  const label = String(baseName || "Untitled").trim() || "Untitled";
  const y = at.getFullYear();
  const mo = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  const h = String(at.getHours()).padStart(2, "0");
  const mi = String(at.getMinutes()).padStart(2, "0");
  return `${label} copy ${y}-${mo}-${d} ${h}:${mi}`;
}
