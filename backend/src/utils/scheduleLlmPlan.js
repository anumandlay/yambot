/**
 * @fileoverview LLM planner for reminder/schedule create & delete phrasing.
 * Purpose: Understand natural “cancel the water nudge” / “remind me every minute to …”
 * as structured ParsedScheduleChat. List stays heuristic-only (instant).
 * Downstream: chatAutoTurn schedule_manage; applyScheduleFromChat still writes schedules[].
 */

import { llmChatCompletion } from "./llmChat.js";
import { SCHEDULE_INTERVALS } from "../models/Agent.js";
import {
  parseScheduleFromChat,
  extractScheduleDisableHint,
  frameComputerScheduleGoal,
  defaultScheduleJobName,
  looksLikeChatReminderRequest,
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
  if (action === "update") action = "create";
  if (action === "list" || action === "show") return { action: "list" };
  if (action !== "create" && action !== "disable") return null;

  if (action === "disable") {
    const matchHint = String(
      raw.matchHint || raw.hint || raw.topic || extractScheduleDisableHint(userText) || ""
    )
      .trim()
      .slice(0, 80);
    return { action: "disable", matchHint };
  }

  // create
  let interval = String(raw.interval || "").trim();
  if (!SCHEDULE_INTERVALS.includes(interval)) {
    const cadence = parseScheduleIntervalFromText(
      String(raw.cadenceText || raw.intervalText || userText || "")
    );
    interval = cadence?.interval || "";
  }
  if (!SCHEDULE_INTERVALS.includes(interval)) return null;

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

  let kind =
    String(raw.kind || "").trim() === "computer" ? "computer" : "chat_reminder";
  // Why: remind-me phrasing always chat nudge even if the model says computer.
  if (looksLikeChatReminderRequest(userText)) kind = "chat_reminder";
  if (
    kind === "chat_reminder" &&
    /\b(check\s+email|unread|composio|notion|slack|sheet)\b/i.test(userText) &&
    !/\bremind\b/i.test(userText)
  ) {
    kind = "computer";
  }

  let goal = String(raw.goal || raw.message || raw.topic || "").trim().slice(0, 8000);
  if (!goal || goal.length < 2) {
    goal = stripScheduleCadenceFromGoal(userText);
  }
  if (!goal || goal.length < 2) return null;

  // Why: Hermes stores a prompt for the tick LLM — keep natural language, light framing only for static.
  if (kind === "chat_reminder" && interval !== "once") {
    // Keep short topics as prompts; frameComputer for computer kinds only below.
  }
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
 * Ask the chat LLM for a schedule create/disable plan (JSON only).
 * @param {string} userText
 * @param {{ apiKey?: string, llmBaseUrl?: string, llmModel?: string, openAiAccountId?: string }} creds
 * @returns {Promise<ParsedScheduleChat|null>}
 */
export async function planScheduleWithLlm(userText, creds) {
  const text = String(userText || "").trim();
  if (!text || !creds?.apiKey) return null;

  const intervals = SCHEDULE_INTERVALS.join("|");
  const system = [
    "You parse YamBot reminder/schedule chat. Reply with JSON only, no markdown.",
    'Schema: {"action":"create"|"disable"|"list","interval":"' +
      intervals +
      '","dailyAt":"HH:MM","kind":"chat_reminder"|"computer","goal":"…","name":"…","matchHint":"…"}',
    "Rules:",
    "- list = show reminders/schedules.",
    "- disable = stop/delete/cancel one or all reminders. Put the topic in matchHint (e.g. \"drink water\"). Empty matchHint means stop all.",
    "- create = new recurring or one-shot reminder/job. Always set interval from the user cadence.",
    "- \"in 30m\" / \"tomorrow at 9 am\" = interval once + oneShotAt ISO time (not daily).",
    "- \"every day at 9 am\" = daily + dailyAt.",
    "- chat_reminder = Hermes-style prompt (LLM on tick). computer = check email / Composio / browser goal.",
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
 * Prefer LLM for create/disable phrasing; list stays heuristic; heuristic is fallback.
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

  // Why: create + delete benefit from LLM NLU; still validate + apply deterministically.
  if (
    heuristic?.action === "create" ||
    heuristic?.action === "disable" ||
    // Soft manage phrases heuristic missed — still try LLM.
    /\b(remind|reminder|schedule|nudge|every\s+\d|every\s+minute|daily)\b/i.test(text) ||
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
