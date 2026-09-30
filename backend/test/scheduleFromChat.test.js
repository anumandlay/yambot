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
  looksLikeScheduleUpdateRequest,
  extractScheduleDisableHint,
  wantsDisableAllSchedules,
  jobMatchesScheduleHint,
  applyScheduleFromChat,
  assistantReplyListedSchedules,
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

test("the sentence parser does not choose list from the wording", () => {
  assert.equal(parseScheduleFromChat("list schedules"), null);
  assert.equal(parseScheduleFromChat("list reminders"), null);
  assert.equal(parseScheduleFromChat("show my reminders"), null);
});

test("a reminder to call an MCP tool is an MCP schedule", () => {
  const t = "create a reminder to call greetme in mockmcp server every 1 min";
  const p = parseScheduleFromChat(t);
  assert.equal(p?.kind, "mcp");
  assert.match(String(p?.goal || ""), /greetme/i);
  assert.equal(p?.interval, "1m");
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
  assert.equal(
    isMeaningfulScheduleJob({ name: "Drink water", goal: "", enabled: false }),
    true
  );
  assert.match(
    formatScheduleListReply([{ enabled: false, goal: "", interval: "1h" }]),
    /No reminders/i
  );
});

test("jobMatchesScheduleHint drink water including disabled", () => {
  assert.equal(
    jobMatchesScheduleHint(
      { name: "Drink water", goal: "💧 Reminder: drink a glass of water.", enabled: false },
      "drink water"
    ),
    true
  );
  assert.equal(
    jobMatchesScheduleHint(
      { name: "Check email", goal: "Check unread email", enabled: true },
      "drink water"
    ),
    false
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

test("tomorrow at 9 am creates one-shot reminder", () => {
  const t = "create reminder to develop project and remind me tomorrow at 9 am";
  assert.equal(looksLikeScheduleManageRequest(t), true);
  const c = parseScheduleIntervalFromText(t);
  assert.equal(c?.interval, "once");
  assert.ok(c?.oneShotAt);
  const p = parseScheduleFromChat(t);
  assert.equal(p?.action, "create");
  assert.equal(p?.interval, "once");
  assert.equal(p?.kind, "chat_reminder");
  assert.match(String(p?.goal || ""), /develop/i);
  assert.doesNotMatch(String(p?.goal || ""), /tomorrow/i);
});

test("in 30 minutes is one-shot", () => {
  const c = parseScheduleIntervalFromText("remind me in 30 minutes to stretch");
  assert.equal(c?.interval, "once");
  assert.ok(c?.oneShotAt);
  const delta = new Date(c.oneShotAt).getTime() - Date.now();
  assert.ok(delta > 25 * 60_000 && delta < 35 * 60_000);
});

test("every 4 minutes and 70 minutes are exact intervals", () => {
  assert.equal(parseScheduleIntervalFromText("every 4 minutes")?.interval, "4m");
  assert.equal(parseScheduleIntervalFromText("every 70 minutes")?.interval, "70m");
  assert.equal(parseScheduleIntervalFromText("every 3 hours")?.interval, "3h");
  assert.equal(scheduleIntervalMs("4m"), 4 * 60 * 1000);
  assert.equal(scheduleIntervalMs("70m"), 70 * 60 * 1000);
  assert.equal(scheduleIntervalMs("3h"), 3 * 60 * 60 * 1000);
});

test("change drink water to every 2 minutes is update not create", () => {
  const t = "change drink water to every 2 minutes";
  assert.equal(looksLikeScheduleManageRequest(t), true);
  assert.equal(looksLikeScheduleUpdateRequest(t), true);
  const p = parseScheduleFromChat(t);
  assert.equal(p?.action, "update");
  assert.equal(p?.interval, "2m");
  assert.match(String(p?.matchHint || ""), /water/i);
});

test("create a reminder, drink water every 1 min is a 1 minute chat reminder", () => {
  const t = "create a reminder, drink water every 1 min";
  assert.equal(looksLikeScheduleManageRequest(t), true);
  const p = parseScheduleFromChat(t);
  assert.equal(p?.action, "create");
  assert.equal(p?.interval, "1m");
  assert.equal(p?.kind, "chat_reminder");
});

test("remind me to drink water every 2 minutes stays create", () => {
  const t = "remind me to drink water every 2 minutes";
  assert.equal(looksLikeScheduleUpdateRequest(t), false);
  const p = parseScheduleFromChat(t);
  assert.equal(p?.action, "create");
  assert.equal(p?.interval, "2m");
  assert.equal(p?.kind, "chat_reminder");
});

test("send email summary frames as inbox check", () => {
  const p = parseScheduleFromChat("send email summary every 10 minutes");
  assert.equal(p?.action, "create");
  assert.equal(p?.interval, "10m");
  assert.equal(p?.kind, "computer");
  assert.match(String(p?.goal || ""), /unread|summar/i);
  assert.doesNotMatch(String(p?.goal || ""), /^send email summary$/i);
});

test("plain check email is not schedule manage", () => {
  assert.equal(looksLikeScheduleManageRequest("check email"), false);
});

test("a copied reminder name deletes that job, and the word 1st does not", async () => {
  const jobs = () => [
    { name: "open nseindia.com", goal: "open nseindia.com", enabled: true, interval: "5m", kind: "computer" },
    { name: "CRM check", goal: "opening vughy.com", enabled: true, interval: "3m", kind: "computer" },
  ];
  const named = {
    schedules: jobs(),
    markModified() {},
    async save() {},
  };
  const byName = await applyScheduleFromChat({
    agent: named,
    parsed: { action: "disable", matchHint: "nseindia" },
    userText: "delete 1st reminder",
  });
  assert.match(byName.content, /nseindia/);
  assert.equal(named.schedules.length, 1);
  assert.equal(named.schedules[0].name, "CRM check");

  const pointed = {
    schedules: jobs(),
    markModified() {},
    async save() {},
  };
  const byWord = await applyScheduleFromChat({
    agent: pointed,
    parsed: { action: "disable", matchHint: "1st" },
    userText: "delete 1st reminder",
  });
  assert.match(byWord.content, /No reminder matched/);
  assert.equal(pointed.schedules.length, 2);
});

test("one listed reminder is removed when the hint does not name it", async () => {
  const agent = {
    schedules: [
      { name: "", goal: "", enabled: false, interval: "1h" },
      { name: "Drink water", goal: "drink water", enabled: true, interval: "3m", kind: "chat_reminder" },
    ],
    markModified() {},
    async save() {},
  };
  const out = await applyScheduleFromChat({
    agent,
    parsed: { action: "disable", matchHint: "it" },
    userText: "delete it",
  });
  assert.match(out.content, /Drink water/);
  assert.equal(agent.schedules.some((job) => job.name === "Drink water"), false);
  assert.equal(assistantReplyListedSchedules([
    { role: "user", content: "list schedules" },
    { role: "assistant", content: "Reminders / schedules on this agent:\n\n1. **Drink water**" },
  ]), true);
  assert.equal(assistantReplyListedSchedules([
    { role: "user", content: "change schedule to every 4 min" },
    { role: "assistant", content: "Updated **Drink water** (on).\nJob 6abd150b89fc0e254f878675.\nThis is the job stored on the agent, under Schedulers." },
    { role: "assistant", content: "drink water" },
  ]), true);
  assert.equal(assistantReplyListedSchedules([
    { role: "user", content: "change schedule to every 4 min" },
    { role: "assistant", content: "Updated **Drink water** (on).\nThis is the job stored on the agent, under Schedulers." },
    { role: "user", content: "delete it" },
    { role: "assistant", content: "drink water" },
    { role: "assistant", content: "Noted. I can't modify schedules directly from chat right now." },
  ]), true);
  assert.equal(assistantReplyListedSchedules([{ role: "assistant", content: "hello" }]), false);
});

test("delete those is not a word-gate schedule request, and the hint is not force-emptied", () => {
  assert.equal(looksLikeScheduleManageRequest("delete those"), false);
  assert.equal(extractScheduleDisableHint("delete those"), "those");
  assert.equal(wantsDisableAllSchedules("delete those", ""), true);
  assert.equal(wantsDisableAllSchedules("delete those", "those"), false);
});

test("pause keeps the reminder and delete still removes it", async () => {
  const pause = parseScheduleFromChat("pause the drink water reminder");
  assert.equal(pause?.action, "pause");
  assert.match(String(pause?.matchHint || ""), /drink water/i);
  assert.equal(parseScheduleFromChat("delete the drink water reminder")?.action, "disable");
  assert.equal(parseScheduleFromChat("resume the drink water reminder")?.action, "resume");
  assert.equal(parseScheduleFromChat("run the drink water reminder now")?.action, "run");

  const agent = {
    schedules: [
      { name: "", goal: "", enabled: false, interval: "1h" },
      {
        name: "Drink water",
        goal: "drink water",
        enabled: true,
        interval: "1m",
        kind: "chat_reminder",
        state: "scheduled",
      },
    ],
    markModified() {},
    async save() {},
  };
  const paused = await applyScheduleFromChat({
    agent,
    parsed: { action: "pause", matchHint: "it" },
    userText: "pause it",
  });
  const water = agent.schedules.find((job) => job.name === "Drink water");
  assert.match(paused.content, /Paused/);
  assert.equal(water.enabled, false);
  assert.equal(water.state, "paused");
  assert.equal(water.nextRunAt, null);
  assert.equal(agent.schedules.length, 2);

  const resumed = await applyScheduleFromChat({
    agent,
    parsed: { action: "resume", matchHint: "Drink water" },
    userText: "resume Drink water",
  });
  assert.match(resumed.content, /Resumed/);
  const resumedWater = agent.schedules.find((job) => job.name === "Drink water");
  assert.equal(resumedWater.enabled, true);
  assert.equal(resumedWater.state, "scheduled");
  assert.ok(resumedWater.nextRunAt);

  const listed = formatScheduleListReply([
    { ...water, enabled: false, state: "paused", lastStatus: "ok" },
  ]);
  assert.match(listed, /paused/);
  assert.match(listed, /last ok/);
});

test("a reminder to email the trial expiring list is a create, not a list", () => {
  const text =
    "create a reminder to send email to fastagconsultant@gmail.com with trial expiring list every 1 hour";
  assert.equal(looksLikeScheduleManageRequest(text), true);
  const p = parseScheduleFromChat(text);
  assert.equal(p?.action, "create");
  assert.equal(p?.interval, "1h");
  assert.equal(p?.kind, "computer");
  assert.match(String(p?.goal || ""), /fastagconsultant@gmail\.com/i);
  assert.match(String(p?.goal || ""), /trial expiring list/i);
  assert.equal(p?.name, "Trial expiring list");
});
