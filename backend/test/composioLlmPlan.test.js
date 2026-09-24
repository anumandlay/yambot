/**
 * @fileoverview Unit checks for Composio LLM plan helpers (collapse + compound detect).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { planComposioMultiSteps } from "../src/utils/composioAutoRuntime.js";
import {
  looksLikeCompoundComposioAsk,
  collapseDuplicateComposioSteps,
} from "../src/utils/composioLlmPlan.js";

test("heuristic collapses double gmail_unread from and-split", () => {
  const plan = planComposioMultiSteps("check email and give me update");
  assert.equal(plan.length, 1);
  assert.equal(plan[0].specId, "gmail_unread");
});

test("looksLikeCompoundComposioAsk", () => {
  assert.equal(looksLikeCompoundComposioAsk("check email and give me update"), true);
  assert.equal(looksLikeCompoundComposioAsk("check email"), false);
});

test("collapseDuplicateComposioSteps keeps different actions", () => {
  const steps = collapseDuplicateComposioSteps([
    { kind: "intent", specId: "sheets_list", toolkit: "googlesheets", label: "Sheets" },
    { kind: "send_email", toolkit: "gmail", label: "Email", to: "a@b.com" },
  ]);
  assert.equal(steps.length, 2);
});
