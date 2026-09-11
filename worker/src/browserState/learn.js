/**
 * @fileoverview Learning layer — site memory, trajectories, post-run hints.
 * Purpose: Phase 5 loads per-domain hints, records compact trajectories, and builds a 40-minute FIFO run summary for the next LLM step.
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

/** How long run findings stay in the next LLM call. Older lines drop first (FIFO). */
const RUN_MEMORY_WINDOW_MS = 40 * 60 * 1000;
/** After the time window, drop oldest lines so the prompt stays a summary, not a transcript. */
const RUN_MEMORY_MAX_LINES = 48;
const RUN_MEMORY_MAX_CHARS = 7000;

/**
 * Collapses whitespace and clips a string for the run-memory prompt.
 * @param {unknown} value
 * @param {number} max
 * @returns {string}
 */
function clipMemory(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Whether a history row is still inside the rolling window.
 * Rows without a timestamp stay (tests and older callers).
 * @param {object} row
 * @param {number} now
 * @returns {boolean}
 */
function inRunMemoryWindow(row, now) {
  const at = Number(row?.at);
  if (!Number.isFinite(at) || at <= 0) return true;
  return now - at <= RUN_MEMORY_WINDOW_MS;
}

/**
 * Numeric report lines and hard failures are kept ahead of ordinary clicks when trimming.
 * @param {string} line
 * @returns {boolean}
 */
function isPinnedMemoryLine(line) {
  return /\$\d|\b(bills?|totals?|confirmed|highest|FAILED)\b/i.test(line);
}

/**
 * Builds one or more summary lines from a single history step.
 * @param {object} row
 * @returns {string[]}
 */
function memoryLinesForStep(row) {
  const action = row?.action || {};
  const type = String(action.type || "");
  const step = row?.step ?? "?";
  const lines = [];
  const thought = clipMemory(row?.thought, 220);
  if (thought && !["bootstrap", "llm_error", "parse_error"].includes(thought)) {
    lines.push(`step ${step}: ${thought}`);
  }
  if (type === "extract") {
    const snippet = clipMemory(row?.result?.snippet || row?.result?.text || "", 280);
    const focus = clipMemory(action.focus, 80);
    if (snippet) lines.push(`step ${step}: extracted — ${snippet}`);
    else if (focus) lines.push(`step ${step}: extracted (${focus})`);
  }
  const failed = row?.result?.ok === false || row?.result?.success === false;
  if (failed && type && type !== "wait") {
    const label = clipMemory(action.name || action.text || action.ref || type, 60);
    const err = clipMemory(row?.result?.error, 100);
    lines.push(
      `step ${step}: FAILED ${type} "${label}"${err ? ` — ${err}` : ""}. Do not retry this exact control.`
    );
  }
  return lines;
}

/**
 * Drops oldest non-fact lines first, then oldest facts, until the FIFO cap fits.
 * @param {string[]} lines
 * @returns {string[]}
 */
function trimRunMemoryFifo(lines) {
  const kept = [...lines];
  while (kept.length > RUN_MEMORY_MAX_LINES) {
    const dropAt = kept.findIndex((line) => !isPinnedMemoryLine(line));
    kept.splice(dropAt >= 0 ? dropAt : 0, 1);
  }
  while (kept.join("\n").length > RUN_MEMORY_MAX_CHARS && kept.length > 1) {
    const dropAt = kept.findIndex((line) => !isPinnedMemoryLine(line));
    kept.splice(dropAt >= 0 ? dropAt : 0, 1);
  }
  return kept;
}

/**
 * Builds a compact summary of this run so the next LLM call does not forget values it already typed
 * or facts it already collected.
 * Why: each call only includes the last few raw actions (current refs). A 1M window could hold the
 * transcript, but resending every page would bury the goal and slow every step. Findings use a
 * 40-minute FIFO window instead — oldest drop first.
 * Credentials stay for the whole run so a password typed at minute 1 is still available at login.
 * @param {object[]} history
 * @returns {string}
 */
export function summarizeSessionContext(history) {
  const steps = Array.isArray(history) ? history : [];
  if (!steps.length) return "";

  /** @type {Record<string, { value: string, field: string, step: number }>} */
  const latest = {};

  for (const h of steps) {
    const action = h?.action || {};
    const type = String(action.type || "");
    if (type !== "type" && type !== "fill_form") continue;
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
        step: h?.step ?? "?",
      };
    }
  }

  const now = Date.now();
  const windowed = steps.filter((row) => inRunMemoryWindow(row, now));
  /** Latest line wins and moves to the end so a restated fact is not dropped as stale. */
  const latestLine = new Map();
  const order = [];
  for (const row of windowed) {
    for (const line of memoryLinesForStep(row)) {
      const key = line.replace(/^step \d+: /, "").toLowerCase();
      const prev = order.indexOf(key);
      if (prev >= 0) order.splice(prev, 1);
      latestLine.set(key, line);
      order.push(key);
    }
  }
  const memory = order.map((key) => latestLine.get(key));
  const compact = trimRunMemoryFifo(memory);

  const credOrder = ["email", "username", "password", "phone"];
  const credLines = credOrder
    .filter((k) => latest[k])
    .map((k) => `- ${k}: ${latest[k].value} (typed into "${latest[k].field}" at step ${latest[k].step})`);

  const parts = [
    "SESSION CONTEXT (this run only — FIFO summary of about the last 40 minutes; older steps are dropped):",
    "If the facts below already answer the goal, call finish with those numbers. Do not repeat a filter, extract, or sort you already completed.",
    credLines.length
      ? `VALUES ALREADY USED (reuse these exact values for login/verify; do NOT ask_user for them):\n${credLines.join("\n")}`
      : "",
    compact.length ? `FACTS AND ACTIONS ALREADY DONE:\n${compact.join("\n")}` : "",
  ].filter(Boolean);
  return parts.join("\n\n");
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
