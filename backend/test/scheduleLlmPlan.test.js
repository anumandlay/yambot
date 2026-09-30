/**
 * @fileoverview Unit checks for LLM schedule plan normalization (no live LLM).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLlmSchedulePlan, schedulePlanFromToolCall } from "../src/utils/scheduleLlmPlan.js";

test("normalizeLlmSchedulePlan create chat reminder", () => {
  const p = normalizeLlmSchedulePlan(
    {
      action: "create",
      interval: "1m",
      kind: "chat_reminder",
      goal: "drink water",
      name: "Drink water",
    },
    "remind me to drink water every 1 minute"
  );
  assert.equal(p?.action, "create");
  assert.equal(p?.interval, "1m");
  assert.equal(p?.kind, "chat_reminder");
  assert.match(String(p?.goal || ""), /water/i);
});

test("normalizeLlmSchedulePlan disable maps delete + matchHint", () => {
  const p = normalizeLlmSchedulePlan(
    { action: "delete", matchHint: "drink water" },
    "delete reminder drink water"
  );
  assert.equal(p?.action, "disable");
  assert.match(String(p?.matchHint || ""), /drink\s+water/i);
});

test("normalizeLlmSchedulePlan keeps the interval the model sent", () => {
  const p = normalizeLlmSchedulePlan(
    { action: "create", interval: "3m", goal: "hi", kind: "chat_reminder" },
    "remind me every 3 minutes to hi"
  );
  assert.equal(p?.action, "create");
  assert.equal(p?.interval, "3m");
});

test("normalizeLlmSchedulePlan rejects when no valid interval anywhere", () => {
  const p = normalizeLlmSchedulePlan(
    { action: "create", interval: "bogus", goal: "hi", kind: "chat_reminder" },
    "remind me sometime"
  );
  assert.equal(p, null);
});

test("normalizeLlmSchedulePlan list", () => {
  assert.equal(normalizeLlmSchedulePlan({ action: "list" }, "list reminders")?.action, "list");
});

test("normalizeLlmSchedulePlan keeps the model action", () => {
  const text =
    "create a reminder to send email to fastagconsultant@gmail.com with trial expiring list every 1 hour";
  assert.equal(normalizeLlmSchedulePlan({ action: "list" }, text)?.action, "list");
  const created = normalizeLlmSchedulePlan(
    {
      action: "create",
      interval: "1h",
      kind: "computer",
      goal: "send email to fastagconsultant@gmail.com with trial expiring list",
      name: "Trial expiring list",
    },
    text
  );
  assert.equal(created?.action, "create");
  assert.equal(created?.interval, "1h");
});

test("normalizeLlmSchedulePlan pause resume and run need no interval", () => {
  const pause = normalizeLlmSchedulePlan(
    { action: "pause", matchHint: "Drink water" },
    "pause the drink water reminder"
  );
  assert.equal(pause?.action, "pause");
  assert.equal(pause?.interval, undefined);
  const resume = normalizeLlmSchedulePlan({ action: "resume", matchHint: "Drink water" }, "resume it");
  assert.equal(resume?.action, "resume");
  const run = normalizeLlmSchedulePlan({ action: "run", matchHint: "Drink water" }, "run it now");
  assert.equal(run?.action, "run");
  assert.equal(normalizeLlmSchedulePlan({ action: "stop", matchHint: "Drink water" }, "stop the reminder")?.action, "pause");
  assert.equal(normalizeLlmSchedulePlan({ action: "start", matchHint: "Drink water" }, "start the reminder")?.action, "resume");
  assert.equal(normalizeLlmSchedulePlan({ action: "delete", matchHint: "Drink water" }, "delete the reminder")?.action, "disable");
});

test("schedulePlanFromToolCall runs the printed pause, resume, time change, start, stop, and delete", () => {
  const id = "6abd4feee0eb1021a501a0f9";
  assert.deepEqual(schedulePlanFromToolCall(`pause_schedule(job_id="${id}")`), {
    action: "pause",
    matchHint: id,
  });
  assert.equal(schedulePlanFromToolCall(`resume_schedule(job_id="${id}")`)?.action, "resume");
  assert.equal(schedulePlanFromToolCall(`start_schedule(job_id="${id}")`)?.action, "resume");
  assert.equal(schedulePlanFromToolCall(`stop_schedule(job_id="${id}")`)?.action, "pause");
  assert.equal(schedulePlanFromToolCall(`run_schedule(job_id="${id}")`)?.action, "run");
  assert.equal(schedulePlanFromToolCall(`delete_schedule(job_id="${id}")`)?.action, "disable");
  const updated = schedulePlanFromToolCall(`update_schedule(job_id="${id}", interval="5m")`);
  assert.equal(updated?.action, "update");
  assert.equal(updated?.interval, "5m");
  assert.equal(updated?.matchHint, id);
});
