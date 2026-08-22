/**
 * @fileoverview Policy helpers — Layer 2 governance rules from user + agent settings.
 * Purpose: Centralize blocked URLs, budgets, and approval requirements for workers and API.
 * Downstream: runtime-config, worker agent loop, task enqueue guards.
 */

/**
 * @param {object} userSettings
 * @param {object} [agent]
 * @returns {object}
 */
export function getEffectivePolicy(userSettings = {}, agent = null) {
  const s = userSettings || {};
  const agentPolicy = agent?.policy || {};
  return {
    requireApprovalForSubmit:
      agentPolicy.requireApprovalForSubmit === true ||
      s.requireApprovalForSubmit === true,
    blockedUrlPatterns: [
      ...(Array.isArray(s.blockedUrlPatterns) ? s.blockedUrlPatterns : []),
      ...(Array.isArray(agentPolicy.blockedUrlPatterns) ? agentPolicy.blockedUrlPatterns : []),
    ],
    monthlyBudgetUsd: Number(agentPolicy.monthlyBudgetUsd || s.monthlyBudgetUsd) || 0,
    dailyBudgetUsd: Number(agentPolicy.dailyBudgetUsd || s.dailyBudgetUsd) || 0,
    maxTaskMinutes: Math.max(0, Number(agentPolicy.maxTaskMinutes || s.maxTaskMinutes) || 0),
    apiBudgetUsd: Number(agentPolicy.apiBudgetUsd || s.apiBudgetUsd) || 0,
    escalateWaitingMinutes: Math.max(
      5,
      Number(agentPolicy.escalateWaitingMinutes || s.escalateWaitingMinutes) || 30
    ),
    httpAllowHosts: [
      ...(Array.isArray(s.httpAllowHosts) ? s.httpAllowHosts : []),
      ...(Array.isArray(agentPolicy.httpAllowHosts) ? agentPolicy.httpAllowHosts : []),
    ],
  };
}

/**
 * @param {string} url
 * @param {string[]} patterns
 * @returns {boolean}
 */
export function isUrlBlocked(url, patterns) {
  const u = String(url || "").toLowerCase();
  for (const raw of patterns || []) {
    const p = String(raw || "").trim().toLowerCase();
    if (!p) continue;
    try {
      if (new RegExp(p, "i").test(u)) return true;
    } catch {
      if (u.includes(p)) return true;
    }
  }
  return false;
}

/**
 * @param {string} url
 * @param {string[]} allowHosts — empty = allow any (except blocked)
 * @returns {boolean}
 */
export function isHttpHostAllowed(url, allowHosts) {
  const list = (allowHosts || []).map((h) => String(h).trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return list.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}
