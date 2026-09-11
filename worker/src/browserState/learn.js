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
 * Classifies a typed field so later steps can reuse email/password from this session.
 * @param {string} name
 * @param {string} text
 * @returns {"password"|"email"|"username"|"phone"|"other"}
 */
function classifyTypedField(name, text) {
  const n = String(name || "").toLowerCase();
  const t = String(text || "");
  if (/pass(word)?|pwd|secret/.test(n)) return "password";
  if (/e-?mail/.test(n) || /@[\w.-]+\.\w{2,}/.test(t)) return "email";
  if (/user(name)?|login|account/.test(n)) return "username";
  if (/phone|mobile/.test(n)) return "phone";
  return "other";
}

/**
 * Builds a compact summary of this run so the next LLM call does not forget values it already typed.
 * Why: only the last few raw actions are sent; registration passwords fall out of that window before login.
 * @param {object[]} history
 * @returns {string}
 */
export function summarizeSessionContext(history) {
  const steps = Array.isArray(history) ? history : [];
  if (!steps.length) return "";

  /** @type {Record<string, { value: string, field: string, step: number }>} */
  const latest = {};
  const lines = [];

  for (const h of steps) {
    const action = h?.action || {};
    const type = String(action.type || "");
    const step = h?.step ?? "?";
    if (type === "type" || type === "fill_form") {
      const fields =
        type === "fill_form" && action.fields && typeof action.fields === "object"
          ? Object.entries(action.fields).map(([name, text]) => ({ name, text }))
          : [{ name: action.name || action.ref || "field", text: action.text }];
      for (const field of fields) {
        const text = String(field.text ?? "").trim();
        if (!text) continue;
        const kind = classifyTypedField(field.name, text);
        const label = String(field.name || kind);
        latest[kind === "other" ? `field:${label}` : kind] = {
          value: text.slice(0, 200),
          field: label,
          step,
        };
        lines.push(`step ${step}: typed ${kind} into "${label}" = ${text.slice(0, 120)}`);
      }
      continue;
    }
    if (type === "navigate" && action.url) {
      lines.push(`step ${step}: opened ${String(action.url).slice(0, 160)}`);
      continue;
    }
    if (type === "click") {
      const label = action.name || action.text || action.ref || "control";
      lines.push(`step ${step}: clicked ${String(label).slice(0, 80)}`);
      continue;
    }
    if (type === "ask_user") {
      lines.push(`step ${step}: asked user — ${String(action.question || "").slice(0, 120)}`);
    }
  }

  const credOrder = ["email", "username", "password", "phone"];
  const credLines = credOrder
    .filter((k) => latest[k])
    .map((k) => `- ${k}: ${latest[k].value} (typed into "${latest[k].field}" at step ${latest[k].step})`);

  const compact = lines.slice(-24).join("\n");
  const parts = [
    "SESSION CONTEXT (this run only — summarized so you do not forget earlier steps):",
    credLines.length
      ? `VALUES ALREADY USED (reuse these exact values for login/verify; do NOT ask_user for them):\n${credLines.join("\n")}`
      : "",
    compact ? `EARLIER STEPS:\n${compact}` : "",
  ].filter(Boolean);
  return parts.join("\n\n").slice(0, 4500);
}

/**
 * Whether an ask_user question is requesting a value already typed this session.
 * @param {string} question
 * @param {object[]} history
 * @returns {{ email?: string, username?: string, password?: string }|null}
 */
export function sessionCredentialsForAsk(question, history) {
  const q = String(question || "").toLowerCase();
  const asking =
    /pass(word)?|pwd|email|e-mail|username|login|credential|account/.test(q);
  if (!asking) return null;
  const summary = summarizeSessionContext(history);
  if (!summary.includes("VALUES ALREADY USED")) return null;
  const found = {};
  for (const key of ["email", "username", "password", "phone"]) {
    const m = summary.match(new RegExp(`- ${key}: (.+?) \\(typed`));
    if (m) found[key] = m[1];
  }
  return Object.keys(found).length ? found : null;
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
      `/api/worker/site-profile?agentId=${encodeURIComponent(agentId)}&domain=${encodeURIComponent(domain)}`
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
    await api("/api/worker/site-profile", {
      method: "POST",
      body: JSON.stringify({ agentId, ...payload }),
    });
  } catch {
    /* non-fatal */
  }
}
