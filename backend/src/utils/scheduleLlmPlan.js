/**
 * @fileoverview LLM planner for reminder/schedule create, update & delete phrasing.
 * Purpose: Understand natural “change schedule to every 4 minutes” / “cancel the water nudge”
 * as structured ParsedScheduleChat. List stays heuristic-only (instant).
 * Downstream: chatAutoTurn schedule_manage; applyScheduleFromChat still writes schedules[].
 */

import { llmChatCompletion } from "./llmChat.js";
import {
  isValidScheduleInterval,
  normalizeScheduleIntervalCode,
} from "../models/Agent.js";
import {
  parseScheduleFromChat,
  extractScheduleDisableHint,
  extractScheduleUpdateHint,
  frameComputerScheduleGoal,
  defaultScheduleJobName,
  looksLikeChatReminderRequest,
  looksLikeScheduleUpdateRequest,
  stripScheduleCadenceFromGoal,
  parseScheduleIntervalFromText,
  parseClockTimeFromText,
} from "./scheduleFromChat.js";

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
  if (action === "stop" || action === "delete" || action === "cancel" || action === "remove") {
    action = "disable";
  }
  if (action === "edit" || action === "modify" || action === "change") {
    action = "update";
  }
  // Why: bare “update” without cadence still may be update if user said change/every.
  if (action === "update" || looksLikeScheduleUpdateRequest(userText)) {
    action = "update";
  }
  if (action === "list" || action === "show") return { action: "list" };
  if (action !== "create" && action !== "disable" && action !== "update") return null;

  if (action === "disable") {
    const matchHint = String(
      raw.matchHint || raw.hint || raw.topic || extractScheduleDisableHint(userText) || ""
    )
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
  if (!isValidScheduleInterval(interval)) {
    const cadence = parseScheduleIntervalFromText(
      String(raw.cadenceText || raw.intervalText || userText || "")
    );
    interval = cadence?.interval || "";
  }
  if (!isValidScheduleInterval(interval)) return null;

  let dailyAt = String(raw.dailyAt || raw.daily_at || "09:00").trim();
  if (!/^\d{1,2}:\d{2}$/.test(dailyAt)) {
    const clock = parseClockTimeFromText(String(raw.timeText || userText || ""));
    dailyAt = clock?.dailyAt || "09:00";
  }

  let oneShotAt = null;
  if (interval === "once") {
    if (raw.oneShotAt || raw.one_shot_at) {
      const d = new Date(raw.oneShotAt || raw.one_shot_at);
      if (!Number.isNaN(d.getTime())) oneShotAt = d;
    }
    if (!oneShotAt) {
      const cadence = parseScheduleIntervalFromText(userText);
      if (cadence?.oneShotAt) oneShotAt = new Date(cadence.oneShotAt);
    }
  }

  if (action === "update") {
    const matchHint = String(
      raw.matchHint || raw.hint || raw.topic || extractScheduleUpdateHint(userText) || ""
    )
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
      plan.goal = frameComputerScheduleGoal(goalRaw.slice(0, 8000));
    }
    return plan;
  }

  // create
  let kind =
    String(raw.kind || "").trim() === "computer" ? "computer" : "chat_reminder";
  // Why: remind-me phrasing always chat nudge even if the model says computer.
  if (looksLikeChatReminderRequest(userText)) kind = "chat_reminder";
  if (
    kind === "chat_reminder" &&
    /\b(check\s+email|unread|composio|notion|slack|sheet|email\s+summary)\b/i.test(userText) &&
    !/\bremind\b/i.test(userText)
  ) {
    kind = "computer";
  }

  let goal = String(raw.goal || raw.message || raw.topic || "").trim().slice(0, 8000);
  if (!goal || goal.length < 2) {
    goal = stripScheduleCadenceFromGoal(userText);
  }
  if (!goal || goal.length < 2) return null;

  goal =
    kind === "computer" ? frameComputerScheduleGoal(goal) : goal.replace(/^to\s+/i, "").trim();

  const name = String(raw.name || defaultScheduleJobName(goal, kind))
    .trim()
    .slice(0, 80);

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
 * @returns {Promise<ParsedScheduleChat|null>}
 */
export async function planScheduleWithLlm(userText, creds) {
  const text = String(userText || "").trim();
  if (!text || !creds?.apiKey) return null;

  const system = [
    "You parse YamBot reminder/schedule chat. Reply with JSON only, no markdown.",
    'Schema: {"action":"create"|"update"|"disable"|"list","interval":"once|daily|Nm|Nh (e.g. 4m, 70m, 3h)","dailyAt":"HH:MM","kind":"chat_reminder"|"computer","goal":"…","name":"…","matchHint":"…"}',
    "Rules:",
    "- list = show reminders/schedules.",
    "- disable = stop/delete/cancel one or all reminders. Put the topic in matchHint (e.g. \"drink water\"). Empty matchHint means stop all.",
    "- update = change cadence (or goal) on an EXISTING reminder. Always set interval. Put which job in matchHint (e.g. \"email\", \"water\"). Example: \"change the schedule to every 4 minutes\" → action update, interval 4m.",
    "- create = new recurring or one-shot reminder/job. Always set interval from the user cadence.",
    "- interval may be ANY minutes/hours: 1m, 3m, 4m, 70m, 2h — not only presets.",
    "- \"in 30m\" / \"tomorrow at 9 am\" = interval once + oneShotAt ISO time (not daily).",
    "- \"every day at 9 am\" = daily + dailyAt.",
    "- chat_reminder = Hermes-style prompt (LLM on tick). computer = check email / email summary / Composio / browser goal.",
    "- \"send email summary\" / \"email summary\" = computer kind, goal about checking unread and summarizing (never blank send).",
    "- Optional repeatLimit (integer) for finite repeats; omit for forever.",
    "- goal for chat_reminder is the prompt body (without every/minute/tomorrow/at cadence).",
    "- dailyAt is 24h UTC when interval is daily; else 09:00.",
    "- If this is not a reminder/schedule manage ask, return {\"action\":\"none\"}.",
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
      { role: "user", content: text },
    ],
  });

  const cleaned = String(raw || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  /** @type {any} */
  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
  if (String(parsed?.action || "").toLowerCase() === "none") return null;
  return normalizeLlmSchedulePlan(parsed, text);
}

/**
 * Prefer LLM for create/update/disable phrasing; list stays heuristic; heuristic is fallback.
 * @param {string} userText
 * @param {{ apiKey?: string, llmBaseUrl?: string, llmModel?: string, openAiAccountId?: string }|null} [creds]
 * @returns {Promise<ParsedScheduleChat|null>}
 */
export async function resolveScheduleFromChat(userText, creds = null) {
  const text = String(userText || "").trim();
  const heuristic = parseScheduleFromChat(text);

  // Why: list must stay instant — no LLM round-trip for “list reminders”.
  if (heuristic?.action === "list") return heuristic;

  if (!creds?.apiKey) return heuristic;

  // Why: create + update + delete benefit from LLM NLU; still validate + apply deterministically.
  if (
    heuristic?.action === "create" ||
    heuristic?.action === "update" ||
    heuristic?.action === "disable" ||
    // Soft manage phrases heuristic missed — still try LLM.
    /\b(remind|reminder|schedule|nudge|every\s+\d|every\s+minute|daily|change|update)\b/i.test(
      text
    ) ||
    /\b(stop|delete|cancel|remove|disable)\b/i.test(text)
  ) {
    try {
      const llmPlan = await planScheduleWithLlm(text, creds);
      if (llmPlan && llmPlan.action !== "list") return llmPlan;
      if (llmPlan?.action === "list") return llmPlan;
    } catch (err) {
      console.warn("[scheduleLlmPlan] plan failed:", err?.message || err);
    }
  }

  return heuristic;
}
