/**
 * @fileoverview Unit checks for Hermes-depth TaskPlan planner helpers.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  looksLikeHermesTaskPlanAsk,
  extractUrlOrDomain,
  heuristicTaskPlanFromText,
  normalizeLlmTaskPlan,
} from "../src/utils/taskPlanPlanner.js";
import {
  applyClarifyAnswerToPlan,
  mergeComputerSummaryIntoWorkingState,
  computerGoalFromPlanStep,
} from "../src/utils/taskPlanRunner.js";

test("looksLikeHermesTaskPlanAsk for example.com + email", () => {
  assert.equal(
    looksLikeHermesTaskPlanAsk(
      "Check example.com and send the title to an email"
    ),
    true
  );
});

test("looksLikeHermesTaskPlanAsk rejects pure check email", () => {
  assert.equal(looksLikeHermesTaskPlanAsk("check email and give me update"), false);
  assert.equal(looksLikeHermesTaskPlanAsk("check email"), false);
});

test("extractUrlOrDomain finds example.com", () => {
  assert.equal(
    extractUrlOrDomain("Check example.com and send the title"),
    "https://example.com"
  );
});

test("heuristic plan missing recipient pauses", () => {
  const p = heuristicTaskPlanFromText(
    "Check example.com and send the title to an email"
  );
  assert.ok(p.missingSlots.includes("email_recipient"));
  assert.ok(p.steps.some((s) => s.kind === "computer"));
  assert.ok(p.steps.some((s) => s.kind === "send_email"));
  assert.ok(p.steps.some((s) => s.kind === "verify"));
  assert.ok(!p.entities.email_recipient);
  assert.equal(p.workingState.needsSendConfirm, true);
});

test("heuristic plan with recipient has no missing slot", () => {
  const p = heuristicTaskPlanFromText(
    "Check example.com and send the title to fastagconsultant@gmail.com"
  );
  assert.equal(p.missingSlots.length, 0);
  assert.equal(p.entities.email_recipient, "fastagconsultant@gmail.com");
  assert.equal(p.workingState.needsSendConfirm, false);
});

test("applyClarifyAnswerToPlan fills email", () => {
  const plan = {
    entities: {},
    workingState: {},
    missingSlots: ["email_recipient"],
    steps: [{ kind: "send_email", to: "", label: "Send email" }],
  };
  assert.equal(applyClarifyAnswerToPlan(plan, "fastagconsultant@gmail.com"), true);
  assert.equal(plan.entities.email_recipient, "fastagconsultant@gmail.com");
  assert.equal(plan.missingSlots.length, 0);
  assert.equal(plan.steps[0].to, "fastagconsultant@gmail.com");
});

test("mergeComputerSummaryIntoWorkingState reads Page title", () => {
  const ws = mergeComputerSummaryIntoWorkingState(
    {},
    "Opened site.\nPage title: Example Domain\nDone."
  );
  assert.equal(ws.pageTitle, "Example Domain");
});

test("computerGoalFromPlanStep adds multi-step note", () => {
  const g = computerGoalFromPlanStep(
    { userText: "Open https://example.com and capture title" },
    { goal: "check example.com" }
  );
  assert.match(g, /MULTI-STEP JOB/i);
  assert.match(g, /Do NOT send email/i);
});

test("normalizeLlmTaskPlan adds verify after send_email", () => {
  const n = normalizeLlmTaskPlan(
    {
      goal: "check example.com and email title",
      entities: { website: "https://example.com", email_recipient: "a@b.com" },
      missingSlots: [],
      steps: [
        {
          id: "s1",
          kind: "computer",
          label: "Open",
          userText: "open example.com",
          dependsOn: [],
        },
        {
          id: "s2",
          kind: "send_email",
          label: "Email",
          to: "a@b.com",
          dependsOn: ["s1"],
          usePriorContent: true,
        },
      ],
    },
    "check example.com and email title to a@b.com"
  );
  assert.ok(n.steps.some((s) => s.kind === "verify"));
  assert.equal(n.workingState.needsSendConfirm, false);
});

test("phase2: confirm / deny / operationId / verify helpers", async () => {
  const {
    looksLikeSendConfirm,
    looksLikeSendDeny,
    buildSendOperationId,
    verifySendAgainstDraft,
    classifyComputerFailure,
  } = await import("../src/utils/taskPlanRunner.js");
  assert.equal(looksLikeSendConfirm("yes"), true);
  assert.equal(looksLikeSendDeny("no"), true);
  const a = buildSendOperationId("p1", "a@b.com", "Sub", "Title");
  const b = buildSendOperationId("p1", "a@b.com", "Sub", "Title");
  assert.equal(a, b);
  assert.match(a, /^send-/);
  const ok = verifySendAgainstDraft({
    sent: true,
    lastSendOk: true,
    lastSendTo: "a@b.com",
    lastSendSubject: "Sub",
    pageTitle: "Example Domain",
    emailDraft: {
      to: "a@b.com",
      subject: "Sub",
      body: "The title is: Example Domain",
    },
  });
  assert.equal(ok.ok, true);
  const bad = verifySendAgainstDraft({
    sent: true,
    lastSendOk: true,
    lastSendTo: "other@b.com",
    lastSendSubject: "Sub",
    emailDraft: { to: "a@b.com", subject: "Sub", body: "x" },
  });
  assert.equal(bad.ok, false);
  assert.equal(classifyComputerFailure("DNS lookup failed").code, "website_unavailable");
});
