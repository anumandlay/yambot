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
} from "../src/utils/scheduleFromChat.js";
import { SCHEDULE_INTERVALS, scheduleIntervalMs } from "../src/models/Agent.js";

test("SCHEDULE_INTERVALS includes 5m", () => {
  assert.ok(SCHEDULE_INTERVALS.includes("5m"));
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
  assert.match(p.goal || "", /check email/i);
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

test("stop the email schedule", () => {
  const p = parseScheduleFromChat("stop the email schedule");
  assert.equal(p?.action, "disable");
  assert.match(String(p?.matchHint || ""), /email/i);
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
