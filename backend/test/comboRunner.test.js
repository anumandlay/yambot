/**
 * @fileoverview Unit checks for cross-mode combo planner (hybrid + Composio-only).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  looksLikeHybridCombo,
  looksLikeComposioOnlyCombo,
  planComboFromText,
  planHybridComposioTail,
  enrichComputerGoalForCombo,
  buildComboFollowupForTask,
  extractComposioTailText,
} from "../src/utils/comboRunner.js";
import { planComposioMultiSteps } from "../src/utils/composioAutoRuntime.js";

test("hybrid: create CRM + email credentials", () => {
  const t =
    "Create a new account in crm and send credentials to fastagconsultant@gmail.com";
  assert.equal(looksLikeHybridCombo(t), true);
  const plan = planComboFromText(t);
  assert.equal(plan.mode, "hybrid");
  assert.ok(plan.composioSteps.some((s) => s.kind === "send_email"));
});

test("hybrid: Vughy results → Notion + Slack + email", () => {
  const t =
    "open vughy and see some results and update in notion and slack and send an email to fastagconsultant@gmail.com";
  assert.equal(looksLikeHybridCombo(t), true);
  const plan = planComboFromText(t);
  assert.equal(plan.mode, "hybrid");
  const follow = buildComboFollowupForTask(t);
  assert.ok(follow);
  assert.ok(follow.steps.length >= 2);
  const toolkits = new Set(follow.steps.map((s) => s.toolkit || s.kind));
  assert.ok(
    [...toolkits].some((x) => /notion/i.test(String(x))) ||
      follow.steps.some((s) => s.specId?.startsWith("notion")),
    "expected a Notion step"
  );
  assert.ok(follow.steps.some((s) => s.kind === "send_slack" || s.toolkit === "slack"));
  assert.ok(follow.steps.some((s) => s.kind === "send_email"));
});

test("enrich computer goal for multi-tail combo", () => {
  const t =
    "open vughy and see results and update in notion and send an email to a@b.com";
  const tail = planHybridComposioTail(t);
  const enriched = enrichComputerGoalForCombo("open vughy and see results", t, tail);
  assert.match(enriched, /MULTI-STEP JOB/i);
  assert.match(enriched, /Do NOT open Gmail/i);
});

test("composio-only: Notion → Slack → email plans 3 steps", () => {
  const t =
    "get the message from notion and update in slack and send an email to fastagconsultant@gmail.com";
  assert.equal(looksLikeHybridCombo(t), false);
  assert.equal(looksLikeComposioOnlyCombo(t), true);
  const steps = planComposioMultiSteps(t);
  assert.ok(steps.length >= 2, `expected >=2 steps, got ${steps.length}`);
  assert.ok(
    steps.some((s) => s.toolkit === "notion" || s.specId?.startsWith("notion")),
    "notion step"
  );
  assert.ok(steps.some((s) => s.kind === "send_slack" || s.toolkit === "slack"));
  assert.ok(steps.some((s) => s.kind === "send_email"));
});

test("extractComposioTailText keeps app verbs", () => {
  const tail = extractComposioTailText(
    "open vughy and see results and update in notion and send an email to a@b.com"
  );
  assert.match(tail, /notion/i);
  assert.match(tail, /email|a@b\.com/i);
});

test("plain open vughy is not hybrid", () => {
  assert.equal(looksLikeHybridCombo("open vughy"), false);
});
