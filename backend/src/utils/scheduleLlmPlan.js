/**
 * @fileoverview LLM planner for reminder/schedule create, update & delete phrasing.
 * Purpose: The schedule model returns the action. This module checks that JSON and does not read words out of the sentence.
 * Downstream: chatAutoTurn schedule_manage; applyScheduleFromChat still writes schedules[].
 */

import { llmChatCompletion } from "./llmChat.js";
import {
  isValidScheduleInterval,
  normalizeScheduleIntervalCode,
} from "../models/Agent.js";

/**
 * @typedef {import("./scheduleFromChat.js").ParsedScheduleChat} ParsedScheduleChat
 */

/**
 * Normalize one LLM JSON object into a validated ParsedScheduleChat.
 * @param {any} raw
 * @param {string} userText
 * @returns {ParsedScheduleChat|null}
 */
export function normalizeLlmSchedulePlan(raw, userText) {
  if (!raw || typeof raw !== "object") return null;
  let action = String(raw.action || "").trim().toLowerCase();
  if (action === "start" || action === "unpause") action = "resume";
  if (action === "stop" || action === "halt") action = "pause";
  if (action === "delete" || action === "cancel" || action === "remove") {
    action = "disable";
  }
  if (action === "edit" || action === "modify" || action === "change") {
    action = "update";
  }
  if (action === "list" || action === "show") return { action: "list" };
  if (action === "pause" || action === "resume" || action === "run") {
    const provided = raw.matchHint ?? raw.hint ?? raw.topic;
    const matchHint = String(provided != null ? provided : "")
      .trim()
      .slice(0, 80);
    return { action, matchHint };
  }
  if (action !== "create" && action !== "disable" && action !== "update") return null;

  if (action === "disable") {
    const provided = raw.matchHint ?? raw.hint ?? raw.topic;
    const matchHint = String(provided != null ? provided : "")
      .trim()
      .slice(0, 80);
    return { action: "disable", matchHint };
  }

  let interval = String(raw.interval || "").trim().toLowerCase();
  if (!isValidScheduleInterval(interval)) {
    interval =
      normalizeScheduleIntervalCode(raw.interval) ||
      normalizeScheduleIntervalCode(raw.cadenceText || raw.intervalText || "") ||
      "";
  }
  if (!isValidScheduleInterval(interval)) return null;

  let dailyAt = String(raw.dailyAt || raw.daily_at || "09:00").trim();
  if (!/^\d{1,2}:\d{2}$/.test(dailyAt)) dailyAt = "09:00";

  let oneShotAt = null;
  if (interval === "once" && (raw.oneShotAt || raw.one_shot_at)) {
    const d = new Date(raw.oneShotAt || raw.one_shot_at);
    if (!Number.isNaN(d.getTime())) oneShotAt = d;
  }

  if (action === "update") {
    const provided = raw.matchHint ?? raw.hint ?? raw.topic;
    const matchHint = String(provided != null ? provided : "")
      .trim()
      .slice(0, 80);
    /** @type {ParsedScheduleChat} */
    const plan = {
      action: "update",
      interval,
      dailyAt,
      oneShotAt,
      matchHint,
    };
    const goalRaw = String(raw.goal || raw.message || "").trim();
    if (goalRaw.length >= 3) {
      plan.goal = goalRaw.slice(0, 8000);
    }
    return plan;
  }

  // create
  const kind = ["mcp", "chat_reminder", "computer"].includes(String(raw.kind || "").trim())
    ? String(raw.kind).trim()
    : "computer";

  const goal = String(raw.goal || raw.message || raw.topic || "").trim().slice(0, 8000);
  if (!goal || goal.length < 2) return null;

  const name = String(raw.name || goal).trim().slice(0, 80);

  const repeatLimit =
    raw.repeatLimit == null && raw.repeat_limit == null
      ? null
      : Math.max(1, Number(raw.repeatLimit ?? raw.repeat_limit) || 1);

  return {
    action: "create",
    interval,
    dailyAt,
    oneShotAt,
    goal,
    kind,
    name,
    agentRun: kind === "chat_reminder",
    repeatLimit,
  };
}

/**
 * Ask the chat LLM for a schedule create/update/disable plan (JSON only).
 * @param {string} userText
 * @param {{ apiKey?: string, llmBaseUrl?: string, llmModel?: string, openAiAccountId?: string }} creds
 * @param {{ role?: string, content?: string }[]} [history]
 * @returns {Promise<ParsedScheduleChat|null>}
 */
export async function planScheduleWithLlm(userText, creds, history = [], reminders = []) {
  const text = String(userText || "").trim();
  if (!text || !creds?.apiKey) return null;
  const recent = (Array.isArray(history) ? history : [])
    .filter((row) => row?.role === "assistant" || row?.role === "user" || row?.role === "agent")
    // Why: pause, resume, and a time change are follow-ups on the last 10 turns.
    .slice(-10)
    .map((row) => `${row.role}: ${String(row.content || "").slice(0, 700)}`)
    .join("\n");
  const saved = (Array.isArray(reminders) ? reminders : [])
    .map((row) => String(row || "").trim())
    .filter(Boolean)
    .slice(0, 8);

  const system = [
    "You parse YamBot reminder/schedule chat. Reply with JSON only, no markdown.",
    'Schema: {"action":"create"|"update"|"pause"|"resume"|"run"|"disable"|"list","interval":"once|daily|Nm|Nh (e.g. 4m, 70m, 3h)","dailyAt":"HH:MM","kind":"chat_reminder"|"computer"|"mcp","goal":"…","name":"…","matchHint":"…"}',
    "Rules:",
    "- list = show the reminders already saved on this agent.",
    "- pause = keep the job and turn it off. stop means pause.",
    "- resume = turn that job back on. start means resume.",
    "- run = fire that job once now.",
    "- disable = delete the job. delete and remove mean disable. Empty matchHint means delete all.",
    "- pause, resume, run, and disable set matchHint to the job name or id copied from Saved reminders. If the sentence does not name a job and only one reminder is saved, leave matchHint empty.",
    "- update = change the time or cadence of a reminder already saved. Always set interval, such as 5m. matchHint is that job's name or id. If the sentence does not name a job and only one reminder is saved, leave matchHint empty.",
    "- pause, resume, start, stop, delete, and a time change are reminder manages. Do not return action none for them. Reply with this JSON only. Do not print a function call.",
    "- create = new recurring or one-shot reminder/job. Always set interval from the cadence in the sentence, such as 2m for two minutes.",
    "- interval may be ANY minutes/hours: 1m, 3m, 4m, 70m, 2h — not only presets.",
    "- \"in 30m\" / \"tomorrow at 9 am\" = interval once + oneShotAt ISO time (not daily).",
    "- \"every day at 9 am\" = daily + dailyAt.",
    "- chat_reminder = a nudge in chat. computer = do the work each time, including sending an email to an address. Keep the recipient and the message in the goal.",
    "- mcp = call a tool on an MCP server every tick (for example call GreetMe on mockmcp). Put the server and tool in the goal. Do not use chat_reminder for that.",
    "- \"send email summary\" / \"email summary\" = computer kind, goal about checking unread and summarizing (never blank send).",
    "- Optional repeatLimit (integer) for finite repeats; omit for forever.",
    "- goal for chat_reminder is the prompt body (without every/minute/tomorrow/at cadence).",
    "- dailyAt is 24h UTC when interval is daily; else 09:00.",
    "- If this is not a reminder/schedule manage ask, return {\"action\":\"none\"}.",
    "- “delete those/them/these” after a reply that listed reminders means disable. Leave matchHint empty so every reminder just listed is stopped. Do not put the word those in matchHint.",
    "- If the latest reply listed reminders and the user is stopping one of them, action is disable and matchHint is that row's name or goal copied from the list. Do not put a pointer word in matchHint.",
    "- If a recent reply confirmed one job (Updated, Created, Paused, Resumed, or Ran) and the user is stopping that job, action is disable and matchHint is the name copied from that reply, such as Drink water. Do not put a pointer word in matchHint.",
  ].join("\n");

  const raw = await llmChatCompletion({
    apiKey: creds.apiKey,
    baseUrl: creds.llmBaseUrl || "",
    model: creds.llmModel || "",
    openAiAccountId: creds.openAiAccountId,
    temperature: 0,
    maxTokens: 400,
    timeoutMs: 20_000,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          saved.length ? `Saved reminders:\n${saved.map((row) => `- ${row}`).join("\n")}` : "Saved reminders: none",
          recent ? `Recent chat:\n${recent}` : "",
          `User: ${text}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
  });

  const cleaned = String(raw || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  const toolPlan = schedulePlanFromToolCall(raw);
  if (!jsonMatch) return toolPlan;
  /** @type {any} */
  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return toolPlan;
  }
  if (String(parsed?.action || "").toLowerCase() === "none") return toolPlan;
  return normalizeLlmSchedulePlan(parsed, text) || toolPlan;
}

/**
 * A model sometimes prints pause_schedule(job_id="…") instead of JSON.
 * That text is the action. Running it writes the job.
 * @param {string} text
 * @returns {ParsedScheduleChat|null}
 */
export function schedulePlanFromToolCall(text) {
  const raw = String(text || "");
  const call = raw.match(/\b([a-z_]+)\s*\(\s*([^)]*)\)/i);
  if (!call) return null;
  const name = call[1].toLowerCase();
  const args = call[2] || "";
  /** @type {Record<string, string>} */
  const actions = {
    pause_schedule: "pause",
    stop_schedule: "pause",
    resume_schedule: "resume",
    start_schedule: "resume",
    run_schedule: "run",
    update_schedule: "update",
    delete_schedule: "disable",
    remove_schedule: "disable",
    disable_schedule: "disable",
  };
  const action = actions[name];
  if (!action) return null;
  const jobId = (args.match(/job_id\s*=\s*["']([a-f0-9]{24})["']/i) || [])[1] || "";
  const named = (args.match(/(?:match_?hint|name)\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
  const matchHint = String(named || jobId).trim().slice(0, 80);
  if (action === "update") {
    const stated = (args.match(/interval\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
    const interval = isValidScheduleInterval(String(stated).trim().toLowerCase())
      ? String(stated).trim().toLowerCase()
      : normalizeScheduleIntervalCode(stated);
    if (!interval) return null;
    return { action: "update", interval, dailyAt: "09:00", matchHint };
  }
  return { action, matchHint };
}

/**
 * A native tool call is the action. The arguments are the model's fields.
 * @param {string} name
 * @param {Record<string, unknown>|null|undefined} args
 * @returns {ParsedScheduleChat|null}
 */
export function schedulePlanFromToolArgs(name, args) {
  const tool = String(name || "").trim().toLowerCase();
  const raw = args && typeof args === "object" ? args : {};
  const hinted = raw.matchHint ?? raw.match_hint ?? raw.job_id ?? raw.jobId ?? raw.hint ?? "";
  /** @type {Record<string, string>} */
  const named = {
    pause_schedule: "pause",
    stop_schedule: "pause",
    resume_schedule: "resume",
    start_schedule: "resume",
    run_schedule: "run",
    update_schedule: "update",
    delete_schedule: "disable",
    remove_schedule: "disable",
    disable_schedule: "disable",
    create_schedule: "create",
  };
  const action =
    tool === "schedule_manage" || tool === "cronjob_manage"
      ? raw.action
      : named[tool];
  if (!action) return null;
  return normalizeLlmSchedulePlan(
    {
      action,
      interval: raw.interval,
      dailyAt: raw.dailyAt || raw.daily_at,
      oneShotAt: raw.oneShotAt || raw.one_shot_at,
      kind: raw.kind,
      goal: raw.goal || raw.message,
      name: raw.name,
      matchHint: hinted || raw.name || "",
      repeatLimit: raw.repeatLimit ?? raw.repeat_limit,
    },
    ""
  );
}

/**
 * Prefer the schedule model's plan. The sentence parser is only the fallback when that plan is missing.
 * @param {string} userText
 * @param {{ apiKey?: string, llmBaseUrl?: string, llmModel?: string, openAiAccountId?: string }|null} [creds]
 * @returns {Promise<ParsedScheduleChat|null>}
 */
export async function resolveScheduleFromChat(userText, creds = null, history = []) {
  const text = String(userText || "").trim();
  if (!text || !creds?.apiKey) return null;
  try {
    return await planScheduleWithLlm(text, creds, history);
  } catch (err) {
    console.warn("[scheduleLlmPlan] plan failed:", err?.message || err);
    return null;
  }
}
