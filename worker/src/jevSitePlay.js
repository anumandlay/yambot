/**
 * @fileoverview Learned website steps for Jev replay.
 * Purpose: The first LLM browser run stores goto/click/fill steps for a site.
 * A later matching goal replays those steps, then the LLM summarizes the live page
 * when the user asked for a list or a summary.
 * Downstream: worker agent.js; POST /api/worker/jev/site-plays.
 */

const STOP = new Set([
  "the",
  "and",
  "then",
  "all",
  "for",
  "with",
  "this",
  "that",
  "from",
  "into",
  "your",
  "get",
  "me",
]);

/**
 * Hostname without www, or empty.
 * @param {string} raw
 * @returns {string}
 */
export function hostFromUrl(raw) {
  try {
    return new URL(String(raw || "").trim()).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * First site mentioned in a goal (URL or bare domain).
 * @param {string} goal
 * @returns {string}
 */
export function hostFromGoal(goal) {
  const text = String(goal || "");
  const url = text.match(/https?:\/\/[^\s)]+/i);
  if (url) return hostFromUrl(url[0]);
  const bare = text.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/i);
  if (!bare) return "";
  const host = bare[0].replace(/^www\./i, "").toLowerCase();
  if (host.includes("@")) return "";
  return host;
}

/**
 * Stable comparison key: drop URLs, emails, and passwords.
 * @param {string} goal
 * @returns {string}
 */
export function normalizeGoalKey(goal) {
  return String(goal || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, " ")
    .replace(/\bpassword\s*[:=]\s*\S+/gi, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

/**
 * @param {string} goal
 * @returns {string[]}
 */
function goalTokens(goal) {
  return normalizeGoalKey(goal)
    .split(" ")
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * Overlap of meaningful words, 0–1.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function goalSimilarity(a, b) {
  const A = goalTokens(a);
  const B = new Set(goalTokens(b));
  if (!A.length || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / Math.max(A.length, B.size);
}

/**
 * True when the user wants the live page read back (list, count, summary).
 * @param {string} goal
 * @returns {boolean}
 */
export function goalWantsLiveSummary(goal) {
  return /\b(list|lists|summar\w*|show\s+me|get\s+me|how\s+many|what\s+are|report|tickets?|results?)\b/i.test(
    String(goal || "")
  );
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function sameHost(a, b) {
  const x = String(a || "").toLowerCase();
  const y = String(b || "").toLowerCase();
  if (!x || !y) return false;
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

/**
 * Best saved play for this goal, or null.
 * Why: a named site can match a bit more loosely; a goal with no site must be very close.
 * @param {object[]} plays
 * @param {string} goal
 * @returns {object|null}
 */
export function matchSitePlay(plays, goal) {
  const host = hostFromGoal(goal);
  const min = host ? 0.55 : 0.72;
  let best = null;
  let bestScore = 0;
  for (const play of plays || []) {
    if (host && play?.host && !sameHost(host, play.host)) continue;
    const score = goalSimilarity(goal, play?.goalSample || play?.goalKey || "");
    if (score >= min && score > bestScore) {
      best = play;
      bestScore = score;
    }
  }
  return best;
}

/**
 * One replayable step from a successful worker action, or null.
 * Passwords are never stored — replay fills them from the goal or the vault.
 * @param {object} action
 * @param {object} [result]
 * @returns {{ op: string, url: string, name: string, text: string, secret: string }|null}
 */
export function stepFromAgentAction(action, result) {
  if (!action || result?.ok === false || result?.skipped) return null;
  const type = String(action.type || "");
  if (type === "navigate" || type === "open_tab") {
    const url = String(action.url || result?.navigated || "").trim();
    if (!/^https?:\/\//i.test(url)) return null;
    return { op: "goto", url: url.slice(0, 500), name: "", text: "", secret: "" };
  }
  if (type === "click") {
    const name = String(action.name || result?.clicked || "").trim();
    if (name.length < 2) return null;
    return { op: "click", url: "", name: name.slice(0, 120), text: "", secret: "" };
  }
  if (type === "type") {
    const name = String(action.name || "").trim();
    if (name.length < 2) return null;
    const secret = /pass(word)?|pwd/i.test(name) ? "password" : "";
    const text = secret ? "" : String(action.text ?? "").slice(0, 200);
    return { op: "fill", url: "", name: name.slice(0, 120), text, secret };
  }
  return null;
}

/**
 * Drop back-to-back duplicates and cap length.
 * @param {object[]} steps
 * @returns {object[]}
 */
export function dedupeSteps(steps) {
  /** @type {object[]} */
  const out = [];
  for (const step of steps || []) {
    if (!step?.op) continue;
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.op === step.op &&
      prev.url === step.url &&
      prev.name === step.name &&
      prev.text === step.text &&
      prev.secret === step.secret
    ) {
      continue;
    }
    out.push(step);
    if (out.length >= 16) break;
  }
  return out;
}

/**
 * Steps worth saving: at least one click or fill (a lone "open" is not a workflow).
 * @param {object[]} steps
 * @returns {boolean}
 */
export function playWorthSaving(steps) {
  return (steps || []).some((s) => s?.op === "click" || s?.op === "fill");
}

/**
 * Password text for a fill step: goal line, else vault row for this host.
 * @param {object} step
 * @param {string} goal
 * @param {object[]} credentials
 * @param {string} host
 * @returns {string}
 */
export function resolveFillText(step, goal, credentials, host) {
  if (step?.secret === "password") {
    const m = String(goal || "").match(/\bpassword\s*[:=]\s*([^\s,;]+)/i);
    if (m) return m[1];
    const h = String(host || "").toLowerCase();
    const row = (credentials || []).find((c) => {
      if (!c?.password) return false;
      const site = String(c.siteHost || "").toLowerCase();
      return !h || !site || sameHost(h, site);
    });
    return String(row?.password || "");
  }
  return String(step?.text || "");
}

/**
 * Ultrafast history → replay steps (start URL plus click/fill labels).
 * @param {object[]} history
 * @param {string} startUrl
 * @returns {object[]}
 */
export function stepsFromUltrafast(history, startUrl) {
  /** @type {object[]} */
  const steps = [];
  if (/^https?:\/\//i.test(String(startUrl || ""))) {
    steps.push({ op: "goto", url: String(startUrl).slice(0, 500), name: "", text: "", secret: "" });
  }
  for (const row of history || []) {
    const kind = String(row?.kind || "").toLowerCase();
    const op = String(row?.operation || "").toUpperCase();
    if (kind === "done" || kind === "blocked" || op === "DONE" || op === "BLOCKED") continue;
    if (kind === "fill" || (row?.text && kind !== "click")) {
      const step = stepFromAgentAction(
        { type: "type", name: String(row.action || row.target || "field"), text: String(row.text || "") },
        { ok: true }
      );
      if (step) steps.push(step);
    } else if (kind === "click" || op === "CLICK") {
      const step = stepFromAgentAction(
        { type: "click", name: String(row.action || row.target || "") },
        { ok: true }
      );
      if (step) steps.push(step);
    }
  }
  return dedupeSteps(steps);
}

/**
 * @param {import('playwright').Page} page
 * @param {string} name
 */
async function clickNamed(page, name) {
  const n = String(name || "").trim();
  const candidates = [
    page.getByRole("button", { name: n }),
    page.getByRole("link", { name: n }),
    page.getByRole("tab", { name: n }),
    page.getByRole("menuitem", { name: n }),
    page.getByText(n, { exact: true }),
  ];
  let last = null;
  for (const loc of candidates) {
    try {
      await loc.first().click({ timeout: 4000 });
      return;
    } catch (err) {
      last = err;
    }
  }
  throw last || new Error(`click not found: ${n}`);
}

/**
 * @param {import('playwright').Page} page
 * @param {string} name
 * @param {string} text
 */
async function fillNamed(page, name, text) {
  const n = String(name || "").trim();
  const candidates = [
    page.getByLabel(n),
    page.getByPlaceholder(n),
    page.getByRole("textbox", { name: n }),
  ];
  let last = null;
  for (const loc of candidates) {
    try {
      await loc.first().fill(String(text ?? ""), { timeout: 4000 });
      return;
    } catch (err) {
      last = err;
    }
  }
  throw last || new Error(`field not found: ${n}`);
}

/**
 * Replay stored steps. A miss returns ok:false so the LLM loop can take over.
 * @param {import('playwright').Page} page
 * @param {object} play
 * @param {{ goal?: string, credentials?: object[] }} ctx
 * @returns {Promise<{ ok: boolean, error?: string, done: string[] }>}
 */
export async function replaySitePlay(page, play, ctx = {}) {
  /** @type {string[]} */
  const done = [];
  const steps = Array.isArray(play?.steps) ? play.steps : [];
  for (const step of steps) {
    try {
      if (step.op === "goto") {
        await page.goto(step.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      } else if (step.op === "click") {
        await clickNamed(page, step.name);
        await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
      } else if (step.op === "fill") {
        const text = resolveFillText(step, ctx.goal || "", ctx.credentials || [], play?.host || "");
        if (step.secret === "password" && !text) {
          return { ok: false, error: "password_missing", done };
        }
        await fillNamed(page, step.name, text);
      } else {
        continue;
      }
      done.push(step.op);
    } catch (err) {
      return { ok: false, error: String(err?.message || err).slice(0, 240), done };
    }
  }
  return { ok: done.length > 0, error: done.length ? "" : "empty_play", done };
}

/**
 * One LLM read of the page that the replay just landed on.
 * @param {import('playwright').Page} page
 * @param {string} goal
 * @param {(opts: object) => Promise<{ content?: string, usage?: object }>} chat
 * @returns {Promise<{ url: string, title: string, summary: string, usage?: object }>}
 */
export async function summarizePageForGoal(page, goal, chat) {
  const url = typeof page?.url === "function" ? page.url() : "";
  const title = await page.title().catch(() => "");
  const text = await page.evaluate(() => String(document.body?.innerText || "").slice(0, 14000));
  const reply = await chat({
    temperature: 0.2,
    maxTokens: 900,
    timeoutMs: 60_000,
    messages: [
      {
        role: "system",
        content: [
          "Navigation and login are already done.",
          "Summarize only what is visible in PAGE TEXT so it answers the user's goal.",
          "Do not invent rows, counts, or tickets that are not in the text.",
          "Plain text. No chain-of-thought.",
        ].join(" "),
      },
      {
        role: "user",
        content: `GOAL:\n${String(goal || "").slice(0, 1500)}\n\nURL: ${url}\nTITLE: ${title}\n\nPAGE TEXT:\n${text}`,
      },
    ],
  });
  return {
    url,
    title,
    summary: String(reply?.content || "").trim(),
    usage: reply?.usage || null,
  };
}

/**
 * POST a learned play. No-op when there is no click/fill or no host.
 * @param {Function} api
 * @param {string} agentId
 * @param {string} goal
 * @param {object[]} steps
 */
export async function persistSitePlay(api, agentId, goal, steps) {
  const compact = dedupeSteps(steps);
  if (!agentId || !playWorthSaving(compact)) return;
  const host =
    hostFromGoal(goal) || hostFromUrl(compact.find((s) => s.op === "goto")?.url || "");
  if (!host) return;
  await api("/api/worker/jev/site-plays", {
    method: "POST",
    body: JSON.stringify({
      agentId,
      host,
      goalSample: String(goal || "").slice(0, 400),
      goalKey: normalizeGoalKey(goal),
      handoff: goalWantsLiveSummary(goal) ? "summarize" : "none",
      steps: compact,
    }),
  });
}
