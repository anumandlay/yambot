/**
 * @fileoverview Learning layer — site memory, trajectories, post-run hints.
 * Purpose: Phase 5 loads per-domain hints and records compact trajectories on complete.
 * Downstream: agent.js task loop; backend SiteProfile + Task.trajectory.
 */

/**
 * Extracts registrable domain from a URL.
 * @param {string} url
 * @returns {string}
 */
export function extractDomain(url) {
  try {
    const host = new URL(String(url || "")).hostname.toLowerCase();
    const parts = host.split(".").filter(Boolean);
    if (parts.length >= 2) return parts.slice(-2).join(".");
    return host;
  } catch {
    return "";
  }
}

/**
 * Builds a compact trajectory from agent step history.
 * @param {object[]} history
 * @param {number} [cap]
 * @returns {object[]}
 */
export function buildTrajectory(history, cap = 80) {
  return (history || []).slice(-cap).map((h) => ({
    step: h.step,
    action: {
      type: h.action?.type,
      ref: h.action?.ref,
      name: h.action?.name,
      url: h.action?.url,
    },
    ok: h.result?.ok !== false && h.result?.verification?.passed !== false,
    failure_class: h.result?.failure_class,
    url_changed: Boolean(h.result?.diff?.url_changed),
    at: new Date().toISOString(),
  }));
}

/**
 * Formats site hints for the LLM prompt.
 * @param {object|null} profile
 * @returns {string}
 */
export function formatSiteHintsBlock(profile) {
  if (!profile?.hints?.length) return "";
  const lines = [`SITE MEMORY (${profile.domain}):`];
  for (const h of profile.hints.slice(0, 8)) {
    lines.push(`  - [${h.kind || "note"}] ${h.content}`);
  }
  if (profile.stats?.successes) {
    lines.push(`  visits: ${profile.stats.visits || 0}, successes: ${profile.stats.successes || 0}`);
  }
  return lines.join("\n");
}

/**
 * Loads site profile for the current domain via worker API.
 * @param {Function} api
 * @param {string} agentId
 * @param {string} domain
 * @returns {Promise<object|null>}
 */
export async function loadSiteProfile(api, agentId, domain) {
  if (!agentId || !domain) return null;
  try {
    const data = await api(
      `/api/extension/site-profile?agentId=${encodeURIComponent(agentId)}&domain=${encodeURIComponent(domain)}`
    );
    return data?.profile || null;
  } catch {
    return null;
  }
}

/**
 * Derives a learnable hint from a completed run.
 * @param {{ success: boolean, summary: string, domain: string, trajectory: object[] }} params
 * @returns {{ kind: string, content: string }|null}
 */
export function deriveSiteHint({ success, summary, domain, trajectory }) {
  if (!domain) return null;
  const failed = (trajectory || []).filter((t) => !t.ok);
  const lastFail = failed[failed.length - 1];
  if (!success && lastFail?.failure_class) {
    return {
      kind: "avoid",
      content: `On ${domain}, ${lastFail.action?.type || "action"} on ${lastFail.action?.ref || "?"} often fails (${lastFail.failure_class}). Try wait_for or different ref.`,
    };
  }
  if (success && summary) {
    return {
      kind: "flow",
      content: `Successful run on ${domain}: ${String(summary).slice(0, 240)}`,
    };
  }
  return null;
}

/**
 * Records site learning after a task completes.
 * @param {Function} api
 * @param {string} agentId
 * @param {object} payload
 */
export async function recordSiteLearning(api, agentId, payload) {
  if (!agentId || !payload?.domain) return;
  try {
    await api("/api/extension/site-profile", {
      method: "POST",
      body: JSON.stringify({ agentId, ...payload }),
    });
  } catch {
    /* non-fatal */
  }
}
