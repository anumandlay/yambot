/**
 * @fileoverview Unit checks for LLM schedule plan normalization (no live LLM).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLlmSchedulePlan } from "../src/utils/scheduleLlmPlan.js";

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

test("normalizeLlmSchedulePlan recovers interval from user text when LLM invents bad code", () => {
  const p = normalizeLlmSchedulePlan(
    { action: "create", interval: "3m", goal: "hi", kind: "chat_reminder" },
    "remind me every 3 minutes to hi"
  );
  assert.equal(p?.action, "create");
  assert.equal(p?.interval, "5m"); // nearest allowed bucket from user text
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
});
