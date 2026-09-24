/**
 * @fileoverview Unit checks for chat → agent schedule parsing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  looksLikeScheduleManageRequest,
  parseScheduleFromChat,
  parseScheduleIntervalFromText,
  stripScheduleCadenceFromGoal,
  formatScheduleIntervalLabel,
  formatScheduleListReply,
  isMeaningfulScheduleJob,
  looksLikeChatReminderRequest,
  extractScheduleDisableHint,
  wantsDisableAllSchedules,
} from "../src/utils/scheduleFromChat.js";
import { SCHEDULE_INTERVALS, scheduleIntervalMs } from "../src/models/Agent.js";

test("SCHEDULE_INTERVALS includes 1m and 5m", () => {
  assert.ok(SCHEDULE_INTERVALS.includes("1m"));
  assert.ok(SCHEDULE_INTERVALS.includes("5m"));
  assert.equal(scheduleIntervalMs("1m"), 60 * 1000);
  assert.equal(scheduleIntervalMs("5m"), 5 * 60 * 1000);
});

test("parse every 5 minutes", () => {
  const iv = parseScheduleIntervalFromText("check email every 5 minutes");
  assert.ok(iv);
  assert.equal(iv.interval, "5m");
});

test("parseScheduleFromChat create check email every 5 minutes", () => {
  const t = "check email every 5 minutes";
  assert.equal(looksLikeScheduleManageRequest(t), true);
  const p = parseScheduleFromChat(t);
  assert.ok(p);
  assert.equal(p.action, "create");
  assert.equal(p.interval, "5m");
  assert.equal(p.kind, "computer");
  assert.match(p.goal || "", /unread|email/i);
  assert.doesNotMatch(p.goal || "", /every 5/i);
});

test("parse multi-step schedule goal keeps steps", () => {
  const t =
    "every 15 minutes check unread email and send a summary to fastagconsultant@gmail.com";
  const p = parseScheduleFromChat(t);
  assert.ok(p);
  assert.equal(p.action, "create");
  assert.equal(p.interval, "15m");
  assert.match(p.goal || "", /unread|email/i);
  assert.match(p.goal || "", /fastagconsultant@gmail\.com/i);
});

test("list schedules", () => {
  const p = parseScheduleFromChat("list schedules");
  assert.equal(p?.action, "list");
});

test("list reminders is schedule list (no LLM)", () => {
  assert.equal(looksLikeScheduleManageRequest("list reminders"), true);
  assert.equal(parseScheduleFromChat("list reminders")?.action, "list");
  assert.equal(looksLikeScheduleManageRequest("show my reminders"), true);
  assert.equal(parseScheduleFromChat("show my reminders")?.action, "list");
});

test("remind me to drink water 1 minutes creates chat_reminder", () => {
  const t = "remind me to drink water 1 minutes";
  assert.equal(looksLikeScheduleManageRequest(t), true);
  assert.equal(looksLikeChatReminderRequest(t), true);
  const p = parseScheduleFromChat(t);
  assert.ok(p);
  assert.equal(p.action, "create");
  assert.equal(p.kind, "chat_reminder");
  assert.equal(p.interval, "1m");
  assert.match(String(p.goal || ""), /water/i);
  assert.match(String(p.goal || ""), /Reminder/i);
});

test("check email every 5 minutes frames computer goal", () => {
  const p = parseScheduleFromChat("check email every 5 minutes");
  assert.equal(p?.kind, "computer");
  assert.equal(p?.interval, "5m");
  assert.match(String(p?.goal || ""), /unread|email/i);
});

test("remind me at 2 pm every day parses dailyAt 14:00", () => {
  const t = "remind me to start doordash at 2 pm every day";
  const cadence = parseScheduleIntervalFromText(t);
  assert.equal(cadence?.interval, "daily");
  assert.equal(cadence?.dailyAt, "14:00");
  const p = parseScheduleFromChat(t);
  assert.equal(p?.kind, "chat_reminder");
  assert.equal(p?.interval, "daily");
  assert.equal(p?.dailyAt, "14:00");
  assert.match(String(p?.goal || ""), /doordash/i);
  assert.doesNotMatch(String(p?.goal || ""), /\b2\s*pm\b/i);
});

test("every day at 2:30pm also works", () => {
  const c = parseScheduleIntervalFromText("check email every day at 2:30pm");
  assert.equal(c?.interval, "daily");
  assert.equal(c?.dailyAt, "14:30");
});

test("empty schedule stubs are not listed as reminders", () => {
  assert.equal(
    isMeaningfulScheduleJob({ enabled: false, goal: "", interval: "1h", name: "" }),
    false
  );
  assert.equal(
    isMeaningfulScheduleJob({
      enabled: true,
      goal: "Remind me to drink water",
      interval: "1h",
      name: "Water",
    }),
    true
  );
  assert.match(
    formatScheduleListReply([{ enabled: false, goal: "", interval: "1h" }]),
    /No reminders/i
  );
});

test("stop the email schedule", () => {
  const p = parseScheduleFromChat("stop the email schedule");
  assert.equal(p?.action, "disable");
  assert.match(String(p?.matchHint || ""), /email/i);
});

test("delete reminder drink water hints drink water only", () => {
  const p = parseScheduleFromChat("delete reminder drink water");
  assert.equal(p?.action, "disable");
  assert.match(String(p?.matchHint || ""), /drink\s+water/i);
  assert.doesNotMatch(String(p?.matchHint || ""), /delete/i);
});

test("extractScheduleDisableHint", () => {
  assert.equal(extractScheduleDisableHint("delete reminder drink water").toLowerCase(), "drink water");
  assert.equal(extractScheduleDisableHint("stop all reminders"), "");
  assert.equal(extractScheduleDisableHint("stop the email schedule").toLowerCase(), "email");
});

test("wantsDisableAllSchedules", () => {
  assert.equal(wantsDisableAllSchedules("stop reminders", ""), true);
  assert.equal(wantsDisableAllSchedules("stop reminder drink water", "drink water"), false);
});

test("stripScheduleCadenceFromGoal", () => {
  const g = stripScheduleCadenceFromGoal(
    "check email every 5 minutes",
    "every 5 minutes"
  );
  assert.equal(g.toLowerCase(), "check email");
});

test("formatScheduleIntervalLabel 5m", () => {
  assert.match(formatScheduleIntervalLabel("5m"), /5 minutes/i);
});

test("plain check email is not schedule manage", () => {
  assert.equal(looksLikeScheduleManageRequest("check email"), false);
});
