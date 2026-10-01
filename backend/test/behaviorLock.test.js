/**
 * @fileoverview Locked outcomes for sentences the product already relies on.
 * Purpose: a new feature adds a test here. It does not change an existing assertion.
 * Downstream: chatAutoTurn.js uses composioIntentSkipsModel, the same function these rows call.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { autoTurnNeedsTools, looksLikeLiveComputerJobRequest } from "../src/utils/chatAutoTurn.js";
import { composioIntentSkipsModel } from "../src/utils/composioAutoRuntime.js";
import { schedulePlanFromToolArgs } from "../src/utils/scheduleLlmPlan.js";
import { normalizeComposioManagePlan } from "../src/utils/composioFromChat.js";

test("check my email is a model Gmail call and does not start the computer", () => {
  assert.equal(composioIntentSkipsModel("check my email"), false);
  assert.equal(autoTurnNeedsTools("check my email"), true);
  assert.equal(looksLikeLiveComputerJobRequest("check my email"), false);
});

test("check for email from doordash.com stays on the model path", () => {
  assert.equal(composioIntentSkipsModel("Check for email from doordash.com"), false);
  assert.equal(autoTurnNeedsTools("Check for email from doordash.com"), true);
  assert.equal(looksLikeLiveComputerJobRequest("Check for email from doordash.com"), false);
});

test("pause_schedule turns the job off", () => {
  const plan = schedulePlanFromToolArgs("pause_schedule", {
    job_id: "6abd4feee0eb1021a501a0f9",
  });
  assert.equal(plan?.action, "pause");
  assert.equal(plan?.matchHint, "6abd4feee0eb1021a501a0f9");
});

test("a 5 minute update keeps the interval the model sent", () => {
  const plan = schedulePlanFromToolArgs("schedule_manage", {
    action: "update",
    interval: "5m",
    matchHint: "Drink water",
  });
  assert.equal(plan?.action, "update");
  assert.equal(plan?.interval, "5m");
});

test("add composio gmail is an app connect and does not start the computer", () => {
  const plan = normalizeComposioManagePlan({ action: "add", app: "gmail" });
  assert.equal(plan?.action, "add");
  assert.equal(plan?.slug, "gmail");
  assert.equal(looksLikeLiveComputerJobRequest("add composio gmail"), false);
});

test("list my spreadsheets still runs before the model", () => {
  assert.equal(composioIntentSkipsModel("list my spreadsheets"), true);
  assert.equal(looksLikeLiveComputerJobRequest("list my spreadsheets"), false);
});
