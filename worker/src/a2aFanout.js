/**
 * @fileoverview A2A v5 fan-out helpers for the Playwright worker.
 * Purpose: Detect parallel multi-peer goals and expand a single-target message_agent into all peers named in the goal.
 * Why: mirrors backend agentMessageBus expandMessageAgentTargetsForFanOut (worker cannot import backend).
 * Downstream: worker/src/agent.js message_agent action.
 */

/**
 * @param {string} goal
 * @returns {boolean}
 */
export function goalRequiresParallelFanOut(goal) {
  const g = String(goal || "");
  if (!g.trim()) return false;
  if (
    /\b(at the same time|in parallel|fan[\s-]?out|simultaneously|all at once)\b/i.test(g)
  ) {
    return true;
  }
  if (/\bboth\b[\s\S]{0,120}\band\b/i.test(g)) return true;
  return false;
}

/**
 * @param {string} goal
 * @param {string[]} peerNames
 * @returns {string[]}
 */
export function peersNamedInGoal(goal, peerNames) {
  const g = String(goal || "").toLowerCase();
  const names = (peerNames || [])
    .map((n) => String(n || "").trim())
    .filter((n) => n.length >= 3)
    .sort((a, b) => b.length - a.length);
  /** @type {string[]} */
  const hit = [];
  let remaining = g;
  for (const name of names) {
    const n = name.toLowerCase();
    if (remaining.includes(n)) {
      hit.push(name);
      remaining = remaining.split(n).join(" ");
    }
  }
  return hit;
}

/**
 * @param {{
 *   goal?: string,
 *   targets?: { to: string, content: string, mode?: string }[],
 *   peerNames?: string[],
 * }} opts
 * @returns {{ targets: { to: string, content: string, mode: string }[], expanded: boolean, required: string[] }}
 */
export function expandMessageAgentTargetsForFanOut(opts) {
  const goal = String(opts.goal || "");
  const peerNames = opts.peerNames || [];
  /** @type {{ to: string, content: string, mode: string }[]} */
  let targets = Array.isArray(opts.targets)
    ? opts.targets.map((t) => ({
        to: String(t?.to || "").trim(),
        content: String(t?.content || "").trim(),
        mode: String(t?.mode || "question").trim() || "question",
      }))
    : [];
  targets = targets.filter((t) => t.to && t.content);
  if (!goalRequiresParallelFanOut(goal) || !targets.length) {
    return { targets, expanded: false, required: [] };
  }
  const required = peersNamedInGoal(goal, peerNames);
  if (required.length < 2) {
    return { targets, expanded: false, required };
  }

  const content = targets[0].content;
  const mode = targets[0].mode || "question";
  /** @type {Map<string, { to: string, content: string, mode: string }>} */
  const byLower = new Map();
  for (const t of targets) {
    byLower.set(t.to.toLowerCase(), t);
  }

  let expanded = false;
  for (const name of required) {
    const key = name.toLowerCase();
    const already = [...byLower.keys()].some(
      (k) => k === key || key.includes(k) || k.includes(key)
    );
    if (!already) {
      byLower.set(key, { to: name, content, mode });
      expanded = true;
    }
  }

  return {
    targets: [...byLower.values()].slice(0, 5),
    expanded,
    required,
  };
}
