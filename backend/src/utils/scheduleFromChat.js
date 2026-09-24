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
 *   kind?: "computer"|"chat_reminder",
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
    case "1m":
      return "every minute";
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
 * Human label for HH:MM (24h UTC stored value).
 * @param {string} dailyAt
 * @returns {string}
 */
export function formatDailyAtLabel(dailyAt) {
  const raw = String(dailyAt || "09:00").trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!m) return `${raw} UTC`;
  const hh = Number(m[1]);
  const mm = m[2];
  const ap = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 || 12;
  return `${h12}:${mm} ${ap} UTC (${String(hh).padStart(2, "0")}:${mm})`;
}

/**
 * Parse a wall-clock time from chat (“at 2 pm”, “2:30pm”, “at 14:00”).
 * @param {string} text
 * @returns {{ dailyAt: string, matchedSpan: string }|null}
 */
export function parseClockTimeFromText(text) {
  const raw = String(text || "");
  const m =
    raw.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) ||
    raw.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) ||
    raw.match(/\bat\s+(\d{1,2}):(\d{2})\b/i);
  if (!m) return null;
  let hh = Number(m[1]);
  let mm = m[2] != null ? Number(m[2]) : 0;
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const ap = String(m[3] || "").toLowerCase();
  if (ap === "pm" && hh < 12) hh += 12;
  if (ap === "am" && hh === 12) hh = 0;
  if (!ap && hh > 23) return null;
  hh = Math.min(23, Math.max(0, hh));
  mm = Math.min(59, Math.max(0, mm));
  return {
    dailyAt: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
    matchedSpan: m[0],
  };
}

/**
 * Map natural cadence phrases to SCHEDULE_INTERVALS (+ optional dailyAt).
 * @param {string} text
 * @returns {{ interval: string, dailyAt: string, matchedSpan: string }|null}
 */
export function parseScheduleIntervalFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const isDaily = /\b(daily|every\s+day|once\s+a\s+day|each\s+day)\b/i.test(raw);
  if (isDaily) {
    const dailyToken = raw.match(/\b(daily|every\s+day|once\s+a\s+day|each\s+day)\b/i);
    // Why: users say “at 2 pm every day” OR “every day at 2 pm” — time may be anywhere.
    const afterDaily = raw.match(
      /\b(?:daily|every\s+day|once\s+a\s+day|each\s+day)\b(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i
    );
    let dailyAt = "09:00";
    /** @type {string[]} */
    const spans = [];
    if (dailyToken) spans.push(dailyToken[0]);

    const clock = parseClockTimeFromText(raw);
    if (clock) {
      dailyAt = clock.dailyAt;
      spans.push(clock.matchedSpan);
    } else if (afterDaily && afterDaily[1] != null) {
      let hh = Number(afterDaily[1]);
      let mm = afterDaily[2] != null ? Number(afterDaily[2]) : 0;
      const ap = String(afterDaily[3] || "").toLowerCase();
      if (ap === "pm" && hh < 12) hh += 12;
      if (ap === "am" && hh === 12) hh = 0;
      dailyAt = `${String(Math.min(23, Math.max(0, hh))).padStart(2, "0")}:${String(
        Math.min(59, Math.max(0, mm))
      ).padStart(2, "0")}`;
      spans.push(afterDaily[0]);
    }

    return {
      interval: "daily",
      dailyAt,
      // Why: join with | so strip can remove non-contiguous “every day” + “at 2 pm”.
      matchedSpan: spans.filter(Boolean).join("|"),
    };
  }

  /** @type {{ re: RegExp, interval: string }[]} */
  const patterns = [
    { re: /\bevery\s*1\s*m(?:in(?:ute)?s?)?\b/i, interval: "1m" },
    { re: /\bevery\s*minute\b/i, interval: "1m" },
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
      if (n <= 1) return { interval: "1m", dailyAt: "09:00", matchedSpan: m[0] };
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
  const compact = raw.match(/\b(?:every\s+)?(1|2|5|15|30)\s*m\b/i);
  if (compact && /\b(every|schedule|repeat|remind|reminder)\b/i.test(raw)) {
    return {
      interval: `${compact[1]}m`,
      dailyAt: "09:00",
      matchedSpan: compact[0],
    };
  }

  // Bare "1 minutes" / "5 minute" (common: “remind me to drink water 1 minutes”)
  const bareMin = raw.match(/\b(\d+)\s*m(?:in(?:ute)?s?)?\b/i);
  if (bareMin && /\b(remind|reminder|schedule|every|nudge|ping)\b/i.test(raw)) {
    const n = Number(bareMin[1]);
    let interval = "5m";
    if (n <= 1) interval = "1m";
    else if (n <= 2) interval = "2m";
    else if (n <= 5) interval = "5m";
    else if (n <= 15) interval = "15m";
    else if (n <= 30) interval = "30m";
    else interval = "1h";
    return { interval, dailyAt: "09:00", matchedSpan: bareMin[0] };
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
  // Why: matchedSpan may be non-contiguous (“every day” + “at 2 pm”) — strip each piece.
  for (const part of String(matchedSpan || "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (part.length >= 2) g = g.replace(part, " ");
  }
  // Also strip common clock / daily tokens even if span order differed.
  const clock = parseClockTimeFromText(g);
  if (clock?.matchedSpan) g = g.replace(clock.matchedSpan, " ");
  g = g
    .replace(
      /\b(schedule|schedules|scheduler|repeat|recurring|automatically|auto)\b/gi,
      " "
    )
    .replace(/\b(remind\s+me(?:\s+to)?|nudge\s+me(?:\s+to)?|ping\s+me(?:\s+to)?|send\s+me\s+a\s+reminder(?:\s+to)?)\b/gi, " ")
    .replace(/\b(every\s+\d+\s*(?:minutes?|mins?|m|hours?|h|days?))\b/gi, " ")
    .replace(/\b(every\s+(?:minute|hour|day))\b/gi, " ")
    .replace(/\b(\d+\s*m(?:in(?:ute)?s?)?)\b/gi, " ")
    .replace(/\b(daily(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?)\b/gi, " ")
    .replace(/\b(once\s+a\s+day|each\s+day|every\s+day)\b/gi, " ")
    .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, " ")
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, " ")
    .replace(/^[:=\-\s]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  // Leading "please" / "can you"
  g = g.replace(/^(please|can you|could you|i want you to|i need you to)\s+/i, "").trim();
  g = g.replace(/^to\s+/i, "").trim();
  return g.slice(0, 8000);
}

/**
 * Short name for the job from the goal.
 * @param {string} goal
 * @param {"computer"|"chat_reminder"} [kind]
 * @returns {string}
 */
export function defaultScheduleJobName(goal, kind = "computer") {
  const g = String(goal || "").trim();
  if (!g) return kind === "chat_reminder" ? "Reminder" : "Scheduled job";
  if (/\b(email|unread|inbox|gmail)\b/i.test(g)) return "Check email";
  if (/\b(drink\s+water|hydrat)\b/i.test(g)) return "Drink water";
  if (/\bnotion\b/i.test(g)) return "Notion sync";
  if (/\bvughy|crm|trial\b/i.test(g)) return "CRM check";
  if (kind === "chat_reminder") return `Remind: ${g}`.slice(0, 48);
  return g.slice(0, 48);
}

/**
 * True when the user wants a chat nudge (not a computer/Composio job).
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeChatReminderRequest(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (/\b(remind\s+me|nudge\s+me|ping\s+me|send\s+me\s+a\s+reminder)\b/i.test(raw)) {
    return true;
  }
  return false;
}

/**
 * Topic left after “delete/stop reminder …” so we can match one job.
 * Why: “delete reminder drink water” must hint “drink water”, not the whole sentence
 * (which never matched haystacks and used to fall back to stopping every schedule).
 * @param {string} text
 * @returns {string}
 */
export function extractScheduleDisableHint(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const named = raw.match(/\b(?:named|called)\s+["']?([^"'\n]{2,60})/i)?.[1]?.trim();
  if (named) return named.slice(0, 80);

  let hint = raw
    .replace(
      /\b(stop|disable|pause|cancel|remove|delete|turn\s+off|clear)\b/gi,
      " "
    )
    .replace(
      /\b(all\s+)?(the\s+)?(my\s+)?(schedules?|schedulers?|reminders?|recurring\s+(?:jobs?|tasks?)|cron\s*jobs?)\b/gi,
      " "
    )
    .replace(/\b(named|called|for|about|regarding)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Why: bare “stop reminders” / “delete all schedules” → empty tip (caller may stop all).
  if (!hint || /^(all|them|everything)$/i.test(hint)) {
    if (/\bemail\b/i.test(raw) && !/\b(drink|water|hydrat)\b/i.test(raw)) return "email";
    return "";
  }
  if (/\bemail\b/i.test(hint) && hint.length <= 12) return "email";
  return hint.slice(0, 80);
}

/**
 * True when the disable ask clearly means every schedule (no topic).
 * @param {string} text
 * @param {string} hint
 * @returns {boolean}
 */
export function wantsDisableAllSchedules(text, hint) {
  const raw = String(text || "").trim();
  if (/\b(all|every)\b.+\b(schedules?|reminders?)\b/i.test(raw)) return true;
  if (/\b(schedules?|reminders?)\b.+\b(all|every)\b/i.test(raw)) return true;
  return !String(hint || "").trim();
}

/**
 * Create-time reminder body (no per-tick LLM).
 * @param {string} topic
 * @returns {string}
 */
export function frameChatReminderMessage(topic) {
  let t = String(topic || "").trim().replace(/^to\s+/i, "");
  if (!t) return "Reminder — time to check in.";
  if (/\b(drink\s+water|hydrat|water)\b/i.test(t)) {
    return "💧 Reminder: drink a glass of water.";
  }
  if (/\b(stand|stretch|break)\b/i.test(t)) {
    return `⏰ Reminder: ${t}.`;
  }
  // Capitalize first letter for a clean chat bubble.
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.!?]$/.test(t)) t += ".";
  return `⏰ Reminder: ${t}`;
}

/**
 * Light framing for computer/Composio scheduled goals.
 * @param {string} goal
 * @returns {string}
 */
export function frameComputerScheduleGoal(goal) {
  let g = String(goal || "").trim();
  if (!g) return g;
  if (/^check\s+(my\s+)?(email|inbox|gmail)\b/i.test(g) && !/unread|summar/i.test(g)) {
    return "Check unread email in the inbox and summarize anything important.";
  }
  if (/^check\s+spam\b/i.test(g)) {
    return "Check the spam/junk folder for important misfiled mail and summarize.";
  }
  return g;
}

/**
 * Nouns users use for agent.schedules[] in chat.
 * Why: people say “reminders” more often than “schedules”.
 */
const SCHEDULE_NOUN =
  "(?:schedules?|schedulers?|reminders?|recurring\\s+(?:jobs?|tasks?)|cron\\s*jobs?)";

/**
 * True when the user is managing schedules (create/list/stop), not running now.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeScheduleManageRequest(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;

  if (
    new RegExp(`\\b(list|show|what are|what'?s)\\b.+\\b${SCHEDULE_NOUN}\\b`, "i").test(raw) ||
    new RegExp(`\\b${SCHEDULE_NOUN}\\b.+\\b(list|show)\\b`, "i").test(raw) ||
    new RegExp(`^(list|show)\\s+(my\\s+)?${SCHEDULE_NOUN}\\b`, "i").test(raw) ||
    /^(list|show)\s+reminders?\b/i.test(raw)
  ) {
    return true;
  }

  if (
    new RegExp(
      `\\b(stop|disable|pause|cancel|remove|delete|turn\\s+off)\\b.+\\b${SCHEDULE_NOUN}\\b`,
      "i"
    ).test(raw) ||
    /\b(stop|disable|pause)\b.+\b(email|checking|check)\b.+\b(schedule|reminder)?\b/i.test(raw) ||
    // Why: “cancel the water nudge” / “delete drink water reminder” — LLM parse fills matchHint.
    /\b(stop|disable|pause|cancel|remove|delete)\b.+\b(nudge|ping|remind(?:er)?|water|hydrat)\b/i.test(
      raw
    )
  ) {
    return true;
  }

  // Create: must have a cadence ("every 5 minutes") — not "schedule a meeting" alone.
  const cadence = parseScheduleIntervalFromText(raw);
  if (!cadence) return false;
  if (/\b(schedule|reminder|remind|repeat|every|daily|recurring)\b/i.test(raw)) return true;
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
    new RegExp(`\\b(list|show|what are|what'?s)\\b.+\\b${SCHEDULE_NOUN}\\b`, "i").test(raw) ||
    new RegExp(`\\b${SCHEDULE_NOUN}\\b.+\\b(list|show)\\b`, "i").test(raw) ||
    new RegExp(`^(list|show)\\s+(my\\s+)?${SCHEDULE_NOUN}\\b`, "i").test(raw) ||
    /^(list|show)\s+reminders?\b/i.test(raw)
  ) {
    return { action: "list" };
  }

  if (
    new RegExp(
      `\\b(stop|disable|pause|cancel|remove|delete|turn\\s+off)\\b.+\\b${SCHEDULE_NOUN}\\b`,
      "i"
    ).test(raw) ||
    /\b(stop|disable|pause)\s+(the\s+)?(email\s+)?(schedule|reminder|checking|check)\b/i.test(raw)
  ) {
    return { action: "disable", matchHint: extractScheduleDisableHint(raw) };
  }

  const cadence = parseScheduleIntervalFromText(raw);
  if (!cadence || !SCHEDULE_INTERVALS.includes(cadence.interval)) return null;

  const kind = looksLikeChatReminderRequest(raw) ? "chat_reminder" : "computer";
  let goal = stripScheduleCadenceFromGoal(raw, cadence.matchedSpan);
  if (!goal || goal.length < 3) {
    return null;
  }
  goal =
    kind === "chat_reminder"
      ? frameChatReminderMessage(goal)
      : frameComputerScheduleGoal(goal);

  return {
    action: "create",
    interval: cadence.interval,
    dailyAt: cadence.dailyAt || "09:00",
    goal,
    kind,
    name: defaultScheduleJobName(goal, kind),
  };
}

/**
 * True when a schedule row is a real reminder (not an empty legacy shell).
 * Why: syncLegacyScheduleMirror / default schema leave `{ enabled:false, goal:"" }` stubs
 * that made “list reminders” show a fake “Job 1 (off)”.
 * @param {object|null|undefined} job
 * @returns {boolean}
 */
export function isMeaningfulScheduleJob(job) {
  if (!job || typeof job !== "object") return false;
  const goal = String(job.goal || "").trim();
  if (goal.length >= 2) return true;
  const name = String(job.name || "").trim();
  // Why: named jobs stay visible/deletable even after disable.
  if (name) return true;
  return false;
}

/**
 * Match a schedule job against a disable/delete topic hint.
 * @param {object} job
 * @param {string} hint
 * @returns {boolean}
 */
export function jobMatchesScheduleHint(job, hint) {
  const h = String(hint || "")
    .toLowerCase()
    .trim()
    .replace(/[“”"']/g, "");
  if (!h) return false;
  const hay = `${job?.name || ""} ${job?.goal || ""}`.toLowerCase();
  if (!hay.trim()) return false;
  if (hay.includes(h)) return true;
  if (h === "email" && /email|unread|inbox|gmail/i.test(hay)) return true;
  // Why: “water” alone should hit “drink a glass of water”.
  const tokens = h
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !/^(the|and|for|reminder|schedule|job)$/i.test(t));
  if (!tokens.length) return false;
  if (tokens.every((tok) => hay.includes(tok))) return true;
  const hits = tokens.filter((tok) => hay.includes(tok)).length;
  return hits >= Math.ceil(tokens.length / 2) && hits >= 1;
}

/**
 * Format jobs for a chat reply.
 * @param {object[]} jobs
 * @returns {string}
 */
export function formatScheduleListReply(jobs) {
  const list = (Array.isArray(jobs) ? jobs : []).filter(isMeaningfulScheduleJob);
  if (!list.length) return "No reminders/schedules on this agent yet.";
  const lines = list.map((j, i) => {
    const on = j.enabled ? "on" : "off";
    const next = j.nextRunAt ? new Date(j.nextRunAt).toISOString() : "—";
    const label = String(j.name || "").trim() || `Job ${i + 1}`;
    const kindLabel = j.kind === "chat_reminder" ? "chat reminder" : "computer job";
    return `${i + 1}. **${label}** (${on}, ${kindLabel}) — ${formatScheduleIntervalLabel(
      j.interval,
      j.dailyAt
    )}${
      j.interval === "daily"
        ? `\n   Time: ${formatDailyAtLabel(j.dailyAt)}`
        : ""
    }\n   ${j.kind === "chat_reminder" ? "Message" : "Goal"}: ${String(j.goal || "").slice(0, 200)}\n   Next: ${next}`;
  });
  return `Reminders / schedules on this agent:\n\n${lines.join("\n\n")}`;
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

  // Why: operate on the full schedules[] (including disabled) so delete can remove an already-off water reminder.
  const sourceJobs =
    Array.isArray(agent.schedules) && agent.schedules.length > 0
      ? agent.schedules
      : listAgentScheduleJobs(agent);
  const jobs = sourceJobs.map((j) => ({
    ...(typeof j.toObject === "function" ? j.toObject() : j),
  }));

  if (parsed.action === "list") {
    return { ok: true, content: formatScheduleListReply(jobs) };
  }

  if (parsed.action === "disable") {
    const hint = String(parsed.matchHint || "").toLowerCase().trim();
    /** @type {string[]} */
    const removedLabels = [];
    /** @type {object[]} */
    let nextJobs = jobs.slice();

    if (hint) {
      const matched = nextJobs.filter((j) => jobMatchesScheduleHint(j, hint));
      if (!matched.length) {
        const available = nextJobs
          .filter(isMeaningfulScheduleJob)
          .map((j) => String(j.name || j.goal || "job").trim().slice(0, 40))
          .filter(Boolean);
        const availBit = available.length
          ? ` On this agent: ${available.map((l) => `“${l}”`).join(", ")}.`
          : " No reminders on this agent.";
        return {
          ok: true,
          content: `No reminder matched “${hint}”.${availBit} Say “list reminders” or “stop all reminders”.`,
        };
      }
      // Why: “delete …” removes the row (even if already off) so list stays clean.
      nextJobs = nextJobs.filter((j) => !jobMatchesScheduleHint(j, hint));
      for (const j of matched) {
        removedLabels.push(String(j.name || j.goal || "job").trim().slice(0, 48) || "job");
      }
    } else if (wantsDisableAllSchedules("stop reminders", hint)) {
      const doomed = nextJobs.filter((j) => isMeaningfulScheduleJob(j));
      for (const j of doomed) {
        removedLabels.push(String(j.name || j.goal || "job").trim().slice(0, 48) || "job");
      }
      nextJobs = nextJobs.filter((j) => !isMeaningfulScheduleJob(j));
    }

    syncLegacyScheduleMirror(agent, nextJobs);
    agent.markModified?.("schedules");
    agent.markModified?.("schedule");
    await agent.save();
    if (!removedLabels.length) {
      return { ok: true, content: "No schedules to stop." };
    }
    const labelBit =
      removedLabels.length === 1
        ? ` (“${removedLabels[0]}”)`
        : removedLabels.length <= 4
          ? `: ${removedLabels.map((l) => `“${l}”`).join(", ")}`
          : "";
    return {
      ok: true,
      content: `Deleted ${removedLabels.length} reminder${removedLabels.length === 1 ? "" : "s"}${labelBit}.`,
    };
  }

  // create / update: upsert by similar goal/name
  const kind = parsed.kind === "chat_reminder" ? "chat_reminder" : "computer";
  const goal = String(parsed.goal || "").trim();
  const interval = parsed.interval || "1h";
  const dailyAt = parsed.dailyAt || "09:00";
  const name = String(parsed.name || defaultScheduleJobName(goal, kind)).slice(0, 80);

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
    kind,
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
  const kindLabel = kind === "chat_reminder" ? "chat reminder" : "computer schedule";
  const when =
    interval === "daily"
      ? `daily at ${formatDailyAtLabel(dailyAt)}`
      : formatScheduleIntervalLabel(interval, dailyAt);
  return {
    ok: true,
    job: saved,
    content:
      `${verb} ${kindLabel} **${name}** — ${when}.\n` +
      `${kind === "chat_reminder" ? "Message" : "Goal"}: ${goal.slice(0, 400)}\n` +
      `Next run: ${nextIso}\n` +
      `You can change it under Agents → Schedulers, or say “list reminders” / “stop the reminder”.`,
  };
}
