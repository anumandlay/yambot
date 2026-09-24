/**
 * @fileoverview Create/list/stop agent schedules from natural-language chat.
 * Purpose: “check email every 5 minutes” saves agent.schedules[] without the editor.
 * Downstream: chatAutoTurn.js (manage path); Agent.schedules + scheduler.js ticks.
 */

import {
  SCHEDULE_INTERVALS,
  computeNextRunAt,
  listAgentScheduleJobs,
  syncLegacyScheduleMirror,
  normalizeScheduleJob,
} from "../models/Agent.js";

/**
 * @typedef {{
 *   action: "create"|"update"|"list"|"disable",
 *   interval?: string,
 *   dailyAt?: string,
 *   goal?: string,
 *   name?: string,
 *   matchHint?: string,
 * }} ParsedScheduleChat
 */

/**
 * Human label for an interval code.
 * @param {string} interval
 * @param {string} [dailyAt]
 * @returns {string}
 */
export function formatScheduleIntervalLabel(interval, dailyAt = "09:00") {
  switch (String(interval || "")) {
    case "2m":
      return "every 2 minutes";
    case "5m":
      return "every 5 minutes";
    case "15m":
      return "every 15 minutes";
    case "30m":
      return "every 30 minutes";
    case "1h":
      return "every hour";
    case "6h":
      return "every 6 hours";
    case "12h":
      return "every 12 hours";
    case "24h":
      return "every 24 hours";
    case "daily":
      return `daily at ${dailyAt || "09:00"} UTC`;
    default:
      return String(interval || "custom");
  }
}

/**
 * Map natural cadence phrases to SCHEDULE_INTERVALS (+ optional dailyAt).
 * @param {string} text
 * @returns {{ interval: string, dailyAt: string, matchedSpan: string }|null}
 */
export function parseScheduleIntervalFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const dailyAtM = raw.match(
    /\b(?:daily|every\s+day|once\s+a\s+day)\b(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i
  );
  if (dailyAtM && /\b(daily|every\s+day|once\s+a\s+day)\b/i.test(raw)) {
    let hh = dailyAtM[1] != null ? Number(dailyAtM[1]) : 9;
    let mm = dailyAtM[2] != null ? Number(dailyAtM[2]) : 0;
    const ap = String(dailyAtM[3] || "").toLowerCase();
    if (ap === "pm" && hh < 12) hh += 12;
    if (ap === "am" && hh === 12) hh = 0;
    const dailyAt = `${String(Math.min(23, Math.max(0, hh))).padStart(2, "0")}:${String(
      Math.min(59, Math.max(0, mm))
    ).padStart(2, "0")}`;
    return { interval: "daily", dailyAt, matchedSpan: dailyAtM[0] };
  }

  /** @type {{ re: RegExp, interval: string }[]} */
  const patterns = [
    { re: /\bevery\s*2\s*m(?:in(?:ute)?s?)?\b/i, interval: "2m" },
    { re: /\bevery\s*5\s*m(?:in(?:ute)?s?)?\b/i, interval: "5m" },
    { re: /\bevery\s*15\s*m(?:in(?:ute)?s?)?\b/i, interval: "15m" },
    { re: /\bevery\s*30\s*m(?:in(?:ute)?s?)?\b/i, interval: "30m" },
    { re: /\bevery\s*(?:1\s*)?hours?\b/i, interval: "1h" },
    { re: /\bevery\s*hour\b/i, interval: "1h" },
    { re: /\bevery\s*6\s*hours?\b/i, interval: "6h" },
    { re: /\bevery\s*12\s*hours?\b/i, interval: "12h" },
    { re: /\bevery\s*24\s*hours?\b/i, interval: "24h" },
    { re: /\bevery\s*(\d+)\s*m(?:in(?:ute)?s?)?\b/i, interval: "" }, // numeric catch
    { re: /\bevery\s*(\d+)\s*h(?:ours?)?\b/i, interval: "" },
  ];

  for (const p of patterns) {
    const m = raw.match(p.re);
    if (!m) continue;
    if (p.interval) {
      return { interval: p.interval, dailyAt: "09:00", matchedSpan: m[0] };
    }
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (/m(?:in)?/i.test(m[0])) {
      if (n <= 2) return { interval: "2m", dailyAt: "09:00", matchedSpan: m[0] };
      if (n <= 5) return { interval: "5m", dailyAt: "09:00", matchedSpan: m[0] };
      if (n <= 15) return { interval: "15m", dailyAt: "09:00", matchedSpan: m[0] };
      if (n <= 30) return { interval: "30m", dailyAt: "09:00", matchedSpan: m[0] };
      return { interval: "1h", dailyAt: "09:00", matchedSpan: m[0] };
    }
    if (n <= 1) return { interval: "1h", dailyAt: "09:00", matchedSpan: m[0] };
    if (n <= 6) return { interval: "6h", dailyAt: "09:00", matchedSpan: m[0] };
    if (n <= 12) return { interval: "12h", dailyAt: "09:00", matchedSpan: m[0] };
    return { interval: "24h", dailyAt: "09:00", matchedSpan: m[0] };
  }

  // Compact: "every 5m" / "5 min schedule"
  const compact = raw.match(/\b(?:every\s+)?(2|5|15|30)\s*m\b/i);
  if (compact && /\b(every|schedule|repeat)\b/i.test(raw)) {
    return {
      interval: `${compact[1]}m`,
      dailyAt: "09:00",
      matchedSpan: compact[0],
    };
  }

  return null;
}

/**
 * Strip cadence phrases so the remainder is the scheduled goal.
 * @param {string} text
 * @param {string} [matchedSpan]
 * @returns {string}
 */
export function stripScheduleCadenceFromGoal(text, matchedSpan = "") {
  let g = String(text || "").trim();
  if (matchedSpan) {
    g = g.replace(matchedSpan, " ");
  }
  g = g
    .replace(
      /\b(schedule|schedules|scheduler|repeat|recurring|automatically|auto)\b/gi,
      " "
    )
    .replace(/\b(every\s+\d+\s*(?:minutes?|mins?|m|hours?|h|days?))\b/gi, " ")
    .replace(/\b(every\s+(?:hour|day))\b/gi, " ")
    .replace(/\b(daily(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?)\b/gi, " ")
    .replace(/\b(once\s+a\s+day)\b/gi, " ")
    .replace(/^[:=\-\s]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  // Leading "please" / "can you"
  g = g.replace(/^(please|can you|could you|i want you to|i need you to)\s+/i, "").trim();
  return g.slice(0, 8000);
}

/**
 * Short name for the job from the goal.
 * @param {string} goal
 * @returns {string}
 */
export function defaultScheduleJobName(goal) {
  const g = String(goal || "").trim();
  if (!g) return "Scheduled job";
  if (/\b(email|unread|inbox|gmail)\b/i.test(g)) return "Check email";
  if (/\bnotion\b/i.test(g)) return "Notion sync";
  if (/\bvughy|crm|trial\b/i.test(g)) return "CRM check";
  return g.slice(0, 48);
}

/**
 * True when the user is managing schedules (create/list/stop), not running now.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeScheduleManageRequest(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;

  if (
    /\b(list|show|what are)\b.+\b(schedules?|schedulers?)\b/i.test(raw) ||
    /\b(schedules?|schedulers?)\b.+\b(list|show)\b/i.test(raw) ||
    /^list\s+schedules?\b/i.test(raw)
  ) {
    return true;
  }

  if (
    /\b(stop|disable|pause|cancel|remove|delete|turn\s+off)\b.+\b(schedule|schedules|scheduler)\b/i.test(
      raw
    ) ||
    /\b(stop|disable|pause)\b.+\b(email|checking|check)\b.+\b(schedule)?\b/i.test(raw)
  ) {
    return true;
  }

  // Create: must have a cadence ("every 5 minutes") — not "schedule a meeting" alone.
  const cadence = parseScheduleIntervalFromText(raw);
  if (!cadence) return false;
  if (/\b(schedule|repeat|every|daily|recurring)\b/i.test(raw)) return true;
  return false;
}

/**
 * Parse a schedule manage message.
 * @param {string} text
 * @returns {ParsedScheduleChat|null}
 */
export function parseScheduleFromChat(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  if (
    /\b(list|show|what are)\b.+\b(schedules?|schedulers?)\b/i.test(raw) ||
    /\b(schedules?|schedulers?)\b.+\b(list|show)\b/i.test(raw) ||
    /^list\s+schedules?\b/i.test(raw)
  ) {
    return { action: "list" };
  }

  if (
    /\b(stop|disable|pause|cancel|remove|delete|turn\s+off)\b.+\b(schedule|schedules|scheduler)\b/i.test(
      raw
    ) ||
    /\b(stop|disable|pause)\s+(the\s+)?(email\s+)?(schedule|checking|check)\b/i.test(raw)
  ) {
    const hint =
      raw.match(/\b(?:named|called)\s+["']?([^"'\n]{2,60})/i)?.[1]?.trim() ||
      (/\bemail\b/i.test(raw) ? "email" : "") ||
      stripScheduleCadenceFromGoal(raw).slice(0, 40);
    return { action: "disable", matchHint: hint || "" };
  }

  const cadence = parseScheduleIntervalFromText(raw);
  if (!cadence || !SCHEDULE_INTERVALS.includes(cadence.interval)) return null;

  const goal = stripScheduleCadenceFromGoal(raw, cadence.matchedSpan);
  if (!goal || goal.length < 3) {
    return null;
  }

  return {
    action: "create",
    interval: cadence.interval,
    dailyAt: cadence.dailyAt || "09:00",
    goal,
    name: defaultScheduleJobName(goal),
  };
}

/**
 * Format jobs for a chat reply.
 * @param {object[]} jobs
 * @returns {string}
 */
export function formatScheduleListReply(jobs) {
  const list = Array.isArray(jobs) ? jobs : [];
  if (!list.length) return "No schedules on this agent yet.";
  const lines = list.map((j, i) => {
    const on = j.enabled ? "on" : "off";
    const next = j.nextRunAt ? new Date(j.nextRunAt).toISOString() : "—";
    const label = String(j.name || "").trim() || `Job ${i + 1}`;
    return `${i + 1}. **${label}** (${on}) — ${formatScheduleIntervalLabel(
      j.interval,
      j.dailyAt
    )}\n   Goal: ${String(j.goal || "").slice(0, 200)}\n   Next: ${next}`;
  });
  return `Schedules on this agent:\n\n${lines.join("\n\n")}`;
}

/**
 * Apply parse result to the agent document (saves).
 * @param {{
 *   agent: import('mongoose').Document,
 *   parsed: ParsedScheduleChat,
 *   chatId?: string|null,
 * }} opts
 * @returns {Promise<{ ok: boolean, content: string, job?: object }>}
 */
export async function applyScheduleFromChat(opts) {
  const agent = opts.agent;
  const parsed = opts.parsed;
  if (!agent || !parsed) {
    return { ok: false, content: "Could not update schedule." };
  }

  const jobs = listAgentScheduleJobs(agent).map((j) => ({
    ...(typeof j.toObject === "function" ? j.toObject() : j),
  }));

  if (parsed.action === "list") {
    return { ok: true, content: formatScheduleListReply(jobs) };
  }

  if (parsed.action === "disable") {
    const hint = String(parsed.matchHint || "").toLowerCase();
    let disabled = 0;
    for (const j of jobs) {
      const hay = `${j.name || ""} ${j.goal || ""}`.toLowerCase();
      const match =
        !hint ||
        hay.includes(hint) ||
        (hint.includes("email") && /email|unread|inbox|gmail/i.test(hay));
      if (match && j.enabled) {
        j.enabled = false;
        j.nextRunAt = null;
        disabled += 1;
      }
    }
    if (!disabled && jobs.length) {
      // Fallback: disable all enabled if hint empty or no match.
      for (const j of jobs) {
        if (j.enabled) {
          j.enabled = false;
          j.nextRunAt = null;
          disabled += 1;
        }
      }
    }
    syncLegacyScheduleMirror(agent, jobs);
    agent.markModified?.("schedules");
    agent.markModified?.("schedule");
    await agent.save();
    if (!disabled) {
      return { ok: true, content: "No enabled schedules to stop." };
    }
    return {
      ok: true,
      content: `Stopped ${disabled} schedule${disabled === 1 ? "" : "s"}.`,
    };
  }

  // create / update: upsert by similar goal/name
  const goal = String(parsed.goal || "").trim();
  const interval = parsed.interval || "1h";
  const dailyAt = parsed.dailyAt || "09:00";
  const name = String(parsed.name || defaultScheduleJobName(goal)).slice(0, 80);

  let existingIdx = jobs.findIndex((j) => {
    const g = String(j.goal || "").trim().toLowerCase();
    return g && g === goal.toLowerCase();
  });
  if (existingIdx < 0) {
    existingIdx = jobs.findIndex((j) => {
      const n = String(j.name || "").trim().toLowerCase();
      return n && n === name.toLowerCase();
    });
  }

  const now = new Date();
  /** @type {object} */
  const jobPayload = normalizeScheduleJob({
    ...(existingIdx >= 0 ? jobs[existingIdx] : {}),
    name,
    enabled: true,
    goal,
    interval,
    dailyAt,
    chatId: opts.chatId || (existingIdx >= 0 ? jobs[existingIdx].chatId : null) || null,
    pausedByEmergency: false,
  });
  jobPayload.nextRunAt = now;
  // Why: first fire on the next scheduler tick; later ticks use computeNextRunAt after each run.

  if (existingIdx >= 0) {
    const prevId = jobs[existingIdx]._id;
    jobs[existingIdx] = { ...jobPayload };
    if (prevId) jobs[existingIdx]._id = prevId;
  } else {
    jobs.push(jobPayload);
  }

  syncLegacyScheduleMirror(agent, jobs);
  agent.markModified?.("schedules");
  agent.markModified?.("schedule");
  await agent.save();

  const saved =
    existingIdx >= 0 ? jobs[existingIdx] : jobs[jobs.length - 1];
  const nextIso = saved.nextRunAt
    ? new Date(saved.nextRunAt).toISOString()
    : "soon";
  const verb = existingIdx >= 0 ? "Updated" : "Created";
  return {
    ok: true,
    job: saved,
    content:
      `${verb} schedule **${name}** — ${formatScheduleIntervalLabel(interval, dailyAt)}.\n` +
      `Goal: ${goal.slice(0, 400)}\n` +
      `Next run: ${nextIso}\n` +
      `You can change it under Agents → Schedulers, or say “list schedules” / “stop the schedule”.`,
  };
}
