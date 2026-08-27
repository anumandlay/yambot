/**
 * @fileoverview Cron matcher — lightweight 5-field cron for time triggers.
 * Purpose: Support cron expressions in addition to intervalMinutes.
 * Downstream: triggerEngine tickTriggers.
 */

/**
 * @param {string} field
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function fieldMatches(field, value, min, max) {
  const f = String(field || "*").trim();
  if (f === "*") return true;
  if (f.startsWith("*/")) {
    const step = Number(f.slice(2)) || 1;
    return value % step === 0;
  }
  if (f.includes(",")) {
    return f.split(",").some((p) => fieldMatches(p.trim(), value, min, max));
  }
  if (f.includes("-")) {
    const [a, b] = f.split("-").map(Number);
    return value >= a && value <= b;
  }
  return Number(f) === value;
}

/**
 * Returns true if cron expression matches the given date (UTC).
 * Format: minute hour day-of-month month day-of-week
 * @param {string} cron
 * @param {Date} [date]
 */
export function cronMatches(cron, date = new Date()) {
  const parts = String(cron || "").trim().split(/\s+/);
  if (parts.length < 5) return false;
  const [min, hour, dom, month, dow] = parts;
  return (
    fieldMatches(min, date.getUTCMinutes(), 0, 59) &&
    fieldMatches(hour, date.getUTCHours(), 0, 23) &&
    fieldMatches(dom, date.getUTCDate(), 1, 31) &&
    fieldMatches(month, date.getUTCMonth() + 1, 1, 12) &&
    fieldMatches(dow, date.getUTCDay(), 0, 6)
  );
}

/**
 * @param {object} config
 * @param {Date} [now]
 */
export function shouldFireCronTrigger(config, now = new Date()) {
  const cron = String(config?.cron || "").trim();
  if (!cron) return false;
  return cronMatches(cron, now);
}
