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
  resolvePendingComboFollowupFromMessages,
  maybeAmbiguousCombo,
  resolveComboFollowupForQueue,
  stepsFromComboTails,
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

test("resolvePendingComboFollowupFromMessages reads newest pending meta", () => {
  const pending = resolvePendingComboFollowupFromMessages([
    {
      _id: "aaaaaaaaaaaaaaaaaaaaaaaa",
      role: "user",
      content: "yes",
    },
    {
      _id: "bbbbbbbbbbbbbbbbbbbbbbbb",
      role: "assistant",
      content: "Computer step finished…",
      meta: {
        kind: "combo_followup_pending",
        pendingComboFollowup: {
          taskId: "task123",
          stepCount: 3,
          stepLabels: ["Notion", "Slack", "email"],
        },
      },
    },
  ]);
  assert.equal(pending?.taskId, "task123");
  assert.equal(pending?.stepCount, 3);
});

test("resolvePendingComboFollowupFromMessages ignores when newest assistant has no pending", () => {
  const pending = resolvePendingComboFollowupFromMessages([
    {
      _id: "cccccccccccccccccccccccc",
      role: "assistant",
      content: "All done",
      meta: { kind: "chat_qa" },
    },
    {
      _id: "bbbbbbbbbbbbbbbbbbbbbbbb",
      role: "assistant",
      content: "old pending",
      meta: {
        kind: "combo_followup_pending",
        pendingComboFollowup: { taskId: "stale", stepCount: 1 },
      },
    },
  ]);
  assert.equal(pending, null);
});

test("create account only is not hybrid and not ambiguous", () => {
  const t = "open vughy.com and create an account as a travel agency";
  assert.equal(looksLikeHybridCombo(t), false);
  assert.equal(maybeAmbiguousCombo(t), false);
  assert.equal(buildComboFollowupForTask(t), null);
  assert.equal(resolveComboFollowupForQueue(t), null);
});

test("form-fill Email/Password rewrite is not a queueable combo", () => {
  const rewritten =
    "Open https://vughy.com/agency/register. Fill out the registration form using dummy data " +
    "(Agency Name: 'Demo Travel Agency', Email: 'demo.travel.agency@example.com', " +
    "Password: 'DemoPass123!'). Click 'Sign Up'.";
  assert.equal(looksLikeHybridCombo(rewritten), false);
  assert.equal(buildComboFollowupForTask(rewritten), null);
  assert.equal(resolveComboFollowupForQueue(rewritten), null);
});

test("resolveComboFollowupForQueue prefers Auto classification", () => {
  const follow = resolveComboFollowupForQueue("open vughy", {
    followup: {
      recipe: "create_then_email",
      userText: "create account and send credentials to a@b.com",
      steps: [{ kind: "send_email", label: "Email a@b.com", toolkit: "gmail" }],
      source: "llm",
    },
  });
  assert.ok(follow);
  assert.equal(follow.source, "llm");
  assert.equal(follow.steps.length, 1);
  assert.equal(follow.steps[0].kind, "send_email");
});

test("stepsFromComboTails maps email/slack/notion", () => {
  const steps = stepsFromComboTails(
    "create account and notify",
    ["email", "slack", "notion"],
    "boss@example.com"
  );
  assert.equal(steps.length, 3);
  assert.ok(steps.some((s) => s.kind === "send_email" && s.to === "boss@example.com"));
  assert.ok(steps.some((s) => s.kind === "send_slack"));
  assert.ok(steps.some((s) => s.specId === "notion_write"));
});

test("explicit send-credentials still builds hybrid followup", async () => {
  const t =
    "Create a new account in crm and send credentials to fastagconsultant@gmail.com";
  const { classifyComboIntent } = await import("../src/utils/comboRunner.js");
  const classified = await classifyComboIntent(t, { skipLlm: true });
  assert.equal(classified.mode, "hybrid");
  assert.equal(classified.source, "heuristic");
  assert.ok(classified.followup?.steps?.some((s) => s.kind === "send_email"));
});
