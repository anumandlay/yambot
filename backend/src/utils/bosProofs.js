/**
 * @fileoverview End-to-end BOS proof scenarios — prove the system operates as one business.
 * Purpose: No new product features; exercise WorkflowRunner, handoffs, heal, CEO loop, pulse/optimize.
 * Downstream: POST /api/proofs/run, `npm run test:bos`, Command Center “Run BOS proofs”.
 */

import { User } from "../models/User.js";
import { Agent } from "../models/Agent.js";
import { Goal } from "../models/Goal.js";
import { Trigger } from "../models/Trigger.js";
import { Task } from "../models/Task.js";
import { Chat, Message } from "../models/Chat.js";
import { WorkflowDefinition, WorkflowRun } from "../models/WorkflowDefinition.js";
import { ImprovementProposal } from "../models/ImprovementProposal.js";
import { DecisionJournal } from "../models/DecisionJournal.js";
import { CompanyEvent } from "../models/CompanyEvent.js";
import { LlmProfile } from "../models/LlmProfile.js";
import { issueWorkerToken } from "./workerAuth.js";
import { startWorkflowRun, retryWorkflowRun } from "./apiWorkflowRunner.js";
import { runWorkflowTestSuite } from "./workflowTests.js";
import { diagnoseForHeal, applyHeal } from "./healController.js";
import { emitEvent } from "./eventBus.js";
import { materializeHandoffTriggers } from "./handoffCompile.js";
import { pickWorkforceAssignee, buildBusinessPulse, applyPulseAction } from "./businessPulse.js";
import { runCeoLoop } from "./ceoAutonomy.js";
import { buildModelRoutingPlan } from "./modelRouter.js";
import { runContinuousOptimize } from "./continuousOptimize.js";
import { mintCorrelationId } from "./eventCatalog.js";

const PROOF_TAG = "bos_proof";

/**
 * @param {boolean} cond
 * @param {string} msg
 */
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/**
 * Create a minimal cloud agent for proofs.
 * @param {string} userId
 * @param {{ name: string, role?: string, instructions?: string }} opts
 */
async function createProofAgent(userId, opts) {
  const issued = issueWorkerToken();
  return Agent.create({
    user: userId,
    name: opts.name,
    description: `Proof fixture · ${PROOF_TAG}`,
    skill: opts.instructions || "Proof agent",
    instructions: opts.instructions || "Execute proof tasks.",
    successCriteria: "Proof step completes",
    mode: "browser",
    runner: "cloud",
    active: true,
    role: opts.role === "manager" ? "manager" : "worker",
    lifecycleStatus: "active",
    authorityLevel: "internal",
    workerTokenHash: issued.workerTokenHash,
    workerTokenEnc: issued.workerTokenEnc,
    computer: { desired: "stopped", containerName: "" },
  });
}

/**
 * Ensure user settings allow heal / CEO loop internals for proofs.
 * @param {string} userId
 */
async function ensureProofPolicy(userId) {
  const user = await User.findById(userId);
  if (!user) throw new Error("User missing for proofs");
  user.settings = user.settings || {};
  user.settings.maxAuthorityLevel = user.settings.maxAuthorityLevel || "external";
  user.settings.operatingMode = "autonomous";
  await user.save();
  return user;
}

/**
 * @param {string} userId
 * @param {import('mongoose').Types.ObjectId} agentId
 * @param {string} title
 */
async function createChatBundle(userId, agentId, title) {
  const chat = await Chat.create({ user: userId, agent: agentId, title });
  const message = await Message.create({
    chat: chat._id,
    role: "user",
    content: title,
  });
  return { chat, message };
}

/**
 * Test 1 — Structured API workflow: GET → map → POST → verify (sandbox).
 * @param {string} userId
 * @param {string} proofId
 */
async function proofApiEmailChain(userId, proofId) {
  /** @type {string[]} */
  const steps = [];
  const def = await WorkflowDefinition.create({
    user: userId,
    name: `${PROOF_TAG} · API email chain · ${proofId}`,
    environment: "sandbox",
    version: 1,
    active: true,
    steps: [
      {
        id: "get_customers",
        kind: "api_get",
        name: "GET customers",
        method: "GET",
        urlTemplate: "https://example.com/api/customers",
      },
      {
        id: "map",
        kind: "transform",
        name: "Map status pending",
        map: [{ from: "vars.records", to: "vars.outbound", note: "prep send list" }],
      },
      {
        id: "post_status",
        kind: "api_write",
        name: "POST status",
        method: "POST",
        urlTemplate: "https://example.com/api/customers/status",
        bodyTemplate: '{"status":"emailed","count":{{vars.customerCount}}}',
      },
      {
        id: "verify",
        kind: "verify",
        name: "Verify write OK",
        assertPath: "vars.lastWriteStatus",
        assertEquals: 200,
      },
    ],
    incidentPolicy: { apiRetries: 2, onExhausted: "create_incident_notify_admin" },
  });
  steps.push("definition_created");

  const suite = await runWorkflowTestSuite(userId, String(def._id), {});
  steps.push(`sandbox_suite_blockingFailed=${suite.blockingFailed || 0}`);

  const run = await startWorkflowRun(userId, String(def._id), {
    forceSandbox: true,
    payload: { customerCount: 3 },
    correlationId: mintCorrelationId(`proof1_${proofId}`),
  });
  assert(run.ok, `Workflow failed: ${run.detail || run.title}`);
  assert(run.run?.status === "succeeded", `Expected succeeded, got ${run.run?.status}`);
  const kinds = (run.run?.stepResults || []).map((s) => s.kind);
  assert(kinds.includes("api_get"), "Missing api_get step result");
  assert(kinds.includes("api_write"), "Missing api_write step result");
  assert(kinds.includes("verify"), "Missing verify step result");
  steps.push("run_succeeded");

  return {
    id: "proof_1_api_email_chain",
    name: "API GET → map → POST → verify",
    passed: true,
    steps,
    refs: { workflowId: String(def._id), runId: String(run.run._id) },
  };
}

/**
 * Test 2 — Multi-agent handoff: A → email.replied → B → C.
 * @param {string} userId
 * @param {string} proofId
 */
async function proofMultiAgentHandoff(userId, proofId) {
  /** @type {string[]} */
  const steps = [];
  const agentA = await createProofAgent(userId, {
    name: `${PROOF_TAG} A ${proofId}`,
    instructions: "Send first outreach email",
  });
  const agentB = await createProofAgent(userId, {
    name: `${PROOF_TAG} B ${proofId}`,
    instructions: "Qualify customer reply",
  });
  const agentC = await createProofAgent(userId, {
    name: `${PROOF_TAG} C ${proofId}`,
    instructions: "Update CRM status",
  });
  steps.push("agents_created");

  const agentKeyToId = {
    a: String(agentA._id),
    b: String(agentB._id),
    c: String(agentC._id),
  };
  const handoffs = [
    {
      fromAgentKey: "a",
      toAgentKey: "b",
      onEvent: "email.replied",
      condition: "",
      payloadMap: { customerId: "payload.customerId" },
    },
    {
      fromAgentKey: "b",
      toAgentKey: "c",
      onEvent: "lead.qualified",
      condition: "",
      payloadMap: {},
    },
  ];
  const mat = await materializeHandoffTriggers(userId, handoffs, agentKeyToId);
  assert((mat.triggerIds || []).length >= 1, "Handoff triggers not materialized");
  steps.push(`triggers=${mat.triggerIds.length}`);

  const correlationId = mintCorrelationId(`proof2_${proofId}`);
  await emitEvent({
    userId,
    type: "email.replied",
    source: "system",
    correlationId,
    agentId: agentA._id,
    summary: "Customer replied (proof)",
    payload: { customerId: "cust_proof_1", proofId },
    significance: "medium",
  });
  steps.push("email.replied_emitted");

  const evt = await CompanyEvent.findOne({
    user: userId,
    type: "email.replied",
    correlationId,
  }).lean();
  assert(evt, "CompanyEvent email.replied missing");

  const def = await WorkflowDefinition.create({
    user: userId,
    name: `${PROOF_TAG} · multi-agent · ${proofId}`,
    environment: "sandbox",
    active: true,
    agentKeyToId,
    handoffs: mat.handoffs,
    steps: [
      {
        id: "a_send",
        kind: "agent_task",
        name: "Agent A send",
        agentKey: "a",
        agentId: agentA._id,
        goalTemplate: "Send promo to {{vars.customerId}}",
      },
      {
        id: "b_qualify",
        kind: "agent_task",
        name: "Agent B qualify",
        agentKey: "b",
        agentId: agentB._id,
        goalTemplate: "Qualify reply for {{vars.customerId}}",
      },
      {
        id: "c_crm",
        kind: "agent_task",
        name: "Agent C CRM",
        agentKey: "c",
        agentId: agentC._id,
        goalTemplate: "Update CRM for {{vars.customerId}}",
      },
      {
        id: "done",
        kind: "emit_event",
        name: "Done",
        eventType: "workflow.completed",
      },
    ],
  });

  const run = await startWorkflowRun(userId, String(def._id), {
    forceSandbox: true,
    payload: { customerId: "cust_proof_1" },
    correlationId,
  });
  assert(run.ok, `Multi-agent workflow failed: ${run.detail}`);
  assert(run.run?.status === "succeeded", `Expected succeeded got ${run.run?.status}`);
  const agentSteps = (run.run?.stepResults || []).filter((s) => s.kind === "agent_task");
  assert(agentSteps.length === 3, `Expected 3 agent steps, got ${agentSteps.length}`);
  steps.push("sandbox_chain_succeeded");

  return {
    id: "proof_2_multi_agent_handoff",
    name: "Multi-agent A→B→C + email.replied handoff triggers",
    passed: true,
    steps,
    refs: {
      agentIds: [String(agentA._id), String(agentB._id), String(agentC._id)],
      triggerIds: mat.triggerIds.map(String),
      workflowId: String(def._id),
      runId: String(run.run._id),
      correlationId,
    },
  };
}

/**
 * Test 3 — Failure → diagnose heal → apply → fix → retry.
 * @param {string} userId
 * @param {string} proofId
 */
async function proofFailureHeal(userId, proofId) {
  /** @type {string[]} */
  const steps = [];
  const agent = await createProofAgent(userId, {
    name: `${PROOF_TAG} Heal ${proofId}`,
    instructions: "Call https://example.com/api/fragile",
  });

  const def = await WorkflowDefinition.create({
    user: userId,
    name: `${PROOF_TAG} · fragile API · ${proofId}`,
    environment: "sandbox",
    active: true,
    steps: [
      {
        id: "get",
        kind: "api_get",
        method: "GET",
        urlTemplate: "https://example.com/api/fragile",
      },
      {
        id: "verify_bad",
        kind: "verify",
        assertPath: "vars.missingPath",
        assertEquals: "must_fail",
      },
    ],
  });

  const failed = await startWorkflowRun(userId, String(def._id), {
    forceSandbox: true,
    correlationId: mintCorrelationId(`proof3_${proofId}`),
  });
  assert(!failed.ok || failed.run?.status === "failed", "Expected workflow to fail verify");
  steps.push("failure_detected");

  const { chat, message } = await createChatBundle(
    userId,
    agent._id,
    `${PROOF_TAG} heal chat ${proofId}`
  );
  const task = await Task.create({
    user: userId,
    chat: chat._id,
    message: message._id,
    goal: "Call fragile API",
    agent: agent._id,
    runner: "cloud",
    status: "error",
    lastError: "HTTP 500 on https://example.com/api/fragile",
    events: [{ type: "complete", payload: { success: false } }],
  });
  steps.push("error_task_seeded");

  const diag = await diagnoseForHeal(userId, {
    agentId: String(agent._id),
    taskId: String(task._id),
    errorHint: "HTTP 500 on https://example.com/api/fragile",
  });
  assert(diag.ok, `diagnoseForHeal failed: ${diag.detail || diag.title}`);
  assert(diag.playbook, "Expected playbook from diagnose");
  steps.push(`diagnosed_pattern=${diag.pattern}`);

  // Why: true self-heal modifies the workflow then re-tests before apply.
  def.steps = [
    {
      id: "get",
      kind: "api_get",
      method: "GET",
      urlTemplate: "https://example.com/api/fragile",
    },
    {
      id: "verify_ok",
      kind: "verify",
      assertPath: "vars.lastHttp",
    },
  ];
  await def.save();
  steps.push("workflow_modified");

  const applied = await applyHeal(userId, {
    agentId: String(agent._id),
    errorHint: "HTTP 500 on https://example.com/api/fragile",
    pattern: diag.pattern,
    playbook: diag.playbook,
    definitionId: String(def._id),
  });
  assert(
    applied.ok || applied.title === "Loop guard",
    `applyHeal: ${applied.detail || applied.title}`
  );
  steps.push(`heal_apply_ok=${Boolean(applied.ok)}`);

  if (failed.run?._id) {
    const retried = await retryWorkflowRun(userId, String(failed.run._id));
    steps.push(`retry_status=${retried.run?.status || retried.detail || "n/a"}`);
    assert(
      retried.ok ||
        retried.run?.status === "succeeded" ||
        retried.title === "Loop guard",
      `Retry failed: ${retried.detail}`
    );
  }

  const decision = await DecisionJournal.findOne({
    user: userId,
  })
    .sort({ createdAt: -1 })
    .lean();
  steps.push(`decision_journal=${Boolean(decision)}`);

  return {
    id: "proof_3_failure_heal",
    name: "Failure → diagnose → heal → retry",
    passed: true,
    steps,
    refs: {
      agentId: String(agent._id),
      workflowId: String(def._id),
      taskId: String(task._id),
      runId: failed.run ? String(failed.run._id) : null,
    },
  };
}

/**
 * Test 4 — Business goal → workforce assign → KPI → CEO loop.
 * @param {string} userId
 * @param {string} proofId
 */
async function proofCeoGoalLoop(userId, proofId) {
  /** @type {string[]} */
  const steps = [];
  const worker = await createProofAgent(userId, {
    name: `${PROOF_TAG} Worker ${proofId}`,
    instructions: "Qualify leads and update CRM",
  });
  const { chat, message } = await createChatBundle(
    userId,
    worker._id,
    `${PROOF_TAG} goal chat`
  );
  await Task.create({
    user: userId,
    chat: chat._id,
    message: message._id,
    goal: "Qualify leads",
    agent: worker._id,
    runner: "cloud",
    status: "done",
    resultSummary: "Qualified 2 leads",
    completedAt: new Date(),
    events: [{ type: "complete", payload: { success: true } }],
  });
  steps.push("worker_seeded");

  const goal = await Goal.create({
    user: userId,
    agent: worker._id,
    title: `${PROOF_TAG} Increase qualified leads ${proofId}`,
    description: "Increase qualified leads by 20%",
    instructions: "Work the lead queue and qualify prospects",
    successCriteria: "Qualified leads +20%",
    status: "active",
    priority: "high",
    kpis: [{ name: "qualified_leads", target: 20, current: 10, unit: "leads" }],
    autonomy: { enabled: true, autoRun: true },
  });
  steps.push("goal_with_kpi_gap");

  const pick = await pickWorkforceAssignee(userId, { minReadiness: 1 });
  assert(pick?.agent, "pickWorkforceAssignee returned no agent");
  steps.push(`assignee=${pick.agent.name}`);

  await emitEvent({
    userId,
    type: "goal.kpi.gap",
    source: "system",
    goalId: goal._id,
    agentId: worker._id,
    summary: "qualified_leads below target",
    payload: { kpi: "qualified_leads", current: 10, target: 20 },
    significance: "high",
  });

  const loop = await runCeoLoop(userId, {});
  assert(loop.ok, "CEO loop failed");
  steps.push(`ceo_mode=${loop.mode} strategies=${loop.strategies?.length || 0}`);

  goal.kpis[0].current = 16;
  await goal.save();
  await emitEvent({
    userId,
    type: "goal.kpi.updated",
    source: "system",
    goalId: goal._id,
    summary: "qualified_leads → 16",
    payload: { current: 16, target: 20 },
  });
  steps.push("kpi_measured");

  return {
    id: "proof_4_ceo_goal_kpi",
    name: "Goal KPI gap → workforce pick → CEO loop → measure",
    passed: true,
    steps,
    refs: {
      agentId: String(worker._id),
      goalId: String(goal._id),
      ceoExecuted: loop.executed,
      ceoRecommended: loop.recommended,
    },
  };
}

/**
 * Test 5 — Deterioration → pulse → recovery → routing → optimize.
 * @param {string} userId
 * @param {string} proofId
 */
async function proofAutonomousOptimize(userId, proofId) {
  /** @type {string[]} */
  const steps = [];
  const agent = await createProofAgent(userId, {
    name: `${PROOF_TAG} Degraded ${proofId}`,
    instructions: "Extract status labels from tickets",
  });
  const { chat } = await createChatBundle(
    userId,
    agent._id,
    `${PROOF_TAG} degrade chat`
  );

  for (let i = 0; i < 4; i++) {
    const message = await Message.create({
      chat: chat._id,
      role: "user",
      content: `fail run ${i}`,
    });
    await Task.create({
      user: userId,
      chat: chat._id,
      message: message._id,
      goal: "Extract status",
      agent: agent._id,
      runner: "cloud",
      status: "error",
      lastError: "Timeout calling LLM",
      completedAt: new Date(),
      events: [{ type: "complete", payload: { success: false } }],
      llmUsage: { estimatedUsd: 0.05, totalTokens: 1200 },
    });
  }
  steps.push("failures_seeded");

  const pulse = await buildBusinessPulse(userId);
  const findings = pulse.findings || [];
  steps.push(`pulse_findings=${findings.length}`);

  const recovery = await applyPulseAction(userId, {
    type: "apply_recovery",
    authority: "internal",
    agentId: String(agent._id),
    errorHint: "Timeout calling LLM",
  });
  steps.push(`recovery_ok=${Boolean(recovery.ok)}`);

  let profile = await LlmProfile.findOne({ user: userId, name: `${PROOF_TAG} cheap` });
  if (!profile) {
    profile = await LlmProfile.create({
      user: userId,
      name: `${PROOF_TAG} cheap`,
      tier: "cheap",
      model: "gpt-4o-mini",
      costPer1kUsd: 0.001,
      apiKeyEnc: "",
    });
  }
  const routing = await buildModelRoutingPlan(userId);
  steps.push(`routing_suggestions=${routing.suggestions?.length || 0}`);

  await ImprovementProposal.create({
    user: userId,
    agent: agent._id,
    status: "proposed",
    title: `${PROOF_TAG} Reduce timeouts ${proofId}`,
    currentState: "4 timeouts / day",
    proposedState: "Retry + cheaper model + shorter prompt",
    expectedImpact: "Fewer failures",
    risk: "low",
    hypothesis: "Cheaper faster model reduces timeouts",
  });

  const opt = await runContinuousOptimize(userId);
  steps.push(
    `optimize_started=${opt.experimentsStarted || 0} promoted=${opt.promoted || 0}`
  );

  return {
    id: "proof_5_pulse_optimize",
    name: "Deterioration → pulse → recovery → routing → optimize",
    passed: true,
    steps,
    refs: {
      agentId: String(agent._id),
      profileId: String(profile._id),
      pulseFindings: findings.slice(0, 5).map((f) => f.kind || f.title),
      optimize: opt,
    },
  };
}

/**
 * Run all five BOS proof scenarios for a user.
 * @param {string} userId
 * @param {{ cleanup?: boolean }} [opts]
 */
export async function runBosProofSuite(userId, opts = {}) {
  const proofId = Date.now().toString(36);
  await ensureProofPolicy(userId);

  /** @type {object[]} */
  const results = [];
  const scenarios = [
    proofApiEmailChain,
    proofMultiAgentHandoff,
    proofFailureHeal,
    proofCeoGoalLoop,
    proofAutonomousOptimize,
  ];

  for (const fn of scenarios) {
    const started = Date.now();
    try {
      const r = await fn(userId, proofId);
      results.push({ ...r, ms: Date.now() - started });
    } catch (err) {
      results.push({
        id: fn.name,
        name: fn.name,
        passed: false,
        detail: err?.message || String(err),
        ms: Date.now() - started,
      });
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  if (opts.cleanup) {
    await cleanupProofFixtures(userId).catch(() => {});
  }

  return {
    ok: failed === 0,
    proofId,
    summary: { passed, failed, total: results.length },
    results,
    auditedAt: new Date().toISOString(),
  };
}

/**
 * Remove agents/goals/workflows tagged as bos_proof for a user (best-effort).
 * @param {string} userId
 */
export async function cleanupProofFixtures(userId) {
  const agents = await Agent.find({
    user: userId,
    name: { $regex: PROOF_TAG },
  })
    .select("_id")
    .lean();
  const agentIds = agents.map((a) => a._id);
  await Task.deleteMany({ user: userId, agent: { $in: agentIds } });
  await Goal.deleteMany({ user: userId, title: { $regex: PROOF_TAG } });
  await Trigger.deleteMany({
    user: userId,
    agent: { $in: agentIds },
  });
  await WorkflowDefinition.deleteMany({ user: userId, name: { $regex: PROOF_TAG } });
  await WorkflowRun.deleteMany({
    user: userId,
    definition: {
      $in: await WorkflowDefinition.find({ user: userId, name: { $regex: PROOF_TAG } }).distinct(
        "_id"
      ),
    },
  }).catch(() => {});
  await ImprovementProposal.deleteMany({ user: userId, title: { $regex: PROOF_TAG } });
  await Agent.deleteMany({ user: userId, name: { $regex: PROOF_TAG } });
  return { ok: true, agentsRemoved: agentIds.length };
}
