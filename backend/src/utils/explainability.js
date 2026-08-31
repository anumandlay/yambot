/**
 * @fileoverview Explainability — reconstruct trigger→policy→employee→action→result chains.
 * Purpose: Learning Mode / “why did this happen” for tasks, workflow runs, correlationIds.
 * Downstream: GET /api/explain/*, CEO explain endpoint, Command Center.
 */

import { Task } from "../models/Task.js";
import { Agent } from "../models/Agent.js";
import { Trigger } from "../models/Trigger.js";
import { Goal } from "../models/Goal.js";
import { CompanyEvent } from "../models/CompanyEvent.js";
import { DecisionJournal } from "../models/DecisionJournal.js";
import { WorkflowRun, WorkflowDefinition } from "../models/WorkflowDefinition.js";
import { AuditEvent } from "../models/AuditEvent.js";
import { User } from "../models/User.js";
import { getEffectivePolicy } from "./policy.js";

/**
 * Build a human-readable explanation for a task / run / correlation.
 * @param {string} userId
 * @param {{ taskId?: string, runId?: string, correlationId?: string }} opts
 */
export async function explainBusinessAction(userId, opts = {}) {
  const taskId = String(opts.taskId || "").trim();
  const runId = String(opts.runId || "").trim();
  let correlationId = String(opts.correlationId || "").trim();

  /** @type {object|null} */
  let task = null;
  if (taskId) {
    task = await Task.findOne({ _id: taskId, user: userId }).lean();
    if (task?.correlationId) correlationId = correlationId || task.correlationId;
    if (task?.workflowRunId && !runId) {
      // keep for chain
    }
  }

  /** @type {object|null} */
  let run = null;
  const effectiveRunId = runId || (task?.workflowRunId ? String(task.workflowRunId) : "");
  if (effectiveRunId) {
    run = await WorkflowRun.findOne({ _id: effectiveRunId, user: userId }).lean();
    if (run?.correlationId) correlationId = correlationId || run.correlationId;
  }

  if (!task && !run && !correlationId) {
    return {
      ok: false,
      title: "Nothing to explain",
      detail: "Provide taskId, runId, or correlationId.",
    };
  }

  /** @type {object|null} */
  let def = null;
  if (run?.definition) {
    def = await WorkflowDefinition.findOne({ _id: run.definition, user: userId })
      .select("name environment version steps")
      .lean();
  }

  const agentId = task?.agent || null;
  const agent = agentId
    ? await Agent.findOne({ _id: agentId, user: userId })
        .select("name role lifecycleStatus authorityLevel instructions successCriteria skill")
        .lean()
    : null;

  const trigger = task?.triggerRef
    ? await Trigger.findOne({ _id: task.triggerRef, user: userId })
        .select("name type config action actionConfig")
        .lean()
    : null;

  const goal = task?.goalRef
    ? await Goal.findOne({ _id: task.goalRef, user: userId })
        .select("title instructions successCriteria kpis")
        .lean()
    : null;

  const user = await User.findById(userId).select("settings").lean();
  const policy = getEffectivePolicy(user?.settings || {});

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const eventFilter = { user: userId, createdAt: { $gte: since } };
  if (correlationId) eventFilter.correlationId = correlationId;
  else if (taskId) eventFilter.taskId = taskId;

  const events = await CompanyEvent.find(eventFilter)
    .sort({ createdAt: 1 })
    .limit(40)
    .lean();

  const decisions = await DecisionJournal.find({
    user: userId,
    createdAt: { $gte: since },
    ...(correlationId
      ? { "context.correlationId": correlationId }
      : taskId
        ? { $or: [{ "context.taskId": taskId }, { "context.taskId": String(taskId) }] }
        : {}),
  })
    .sort({ createdAt: -1 })
    .limit(15)
    .lean();

  const audits = await AuditEvent.find({
    user: userId,
    createdAt: { $gte: since },
    ...(taskId ? { taskId: String(taskId) } : {}),
  })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  /** Ordered chain for Learning Mode UI */
  /** @type {{ stage: string, summary: string, detail?: string }[]} */
  const chain = [];

  if (trigger) {
    chain.push({
      stage: "trigger",
      summary: `Trigger “${trigger.name}” (${trigger.type})`,
      detail: JSON.stringify(trigger.config || {}).slice(0, 400),
    });
  } else if (task?.events?.[0]?.payload?.source) {
    chain.push({
      stage: "trigger",
      summary: `Enqueued from source “${task.events[0].payload.source}”`,
    });
  } else if (run) {
    chain.push({
      stage: "trigger",
      summary: `Workflow “${def?.name || run.definition}” run started`,
      detail: `environment=${run.environment} correlation=${run.correlationId}`,
    });
  }

  chain.push({
    stage: "policy",
    summary: `Operating mode “${user?.settings?.operatingMode || "assisted"}”; max authority “${user?.settings?.maxAuthorityLevel || "external"}”`,
    detail: `httpAllowHosts=${(policy.httpAllowHosts || []).slice(0, 5).join(", ") || "(open)"}`,
  });

  if (agent) {
    chain.push({
      stage: "employee",
      summary: `${agent.name} (${agent.role}, lifecycle=${agent.lifecycleStatus || "active"}, authority=${agent.authorityLevel || "external"})`,
      detail: String(agent.successCriteria || agent.skill || "").slice(0, 300),
    });
  }

  if (goal) {
    chain.push({
      stage: "data",
      summary: `Goal “${goal.title}”`,
      detail: String(goal.instructions || "").slice(0, 300),
    });
  }

  if (task) {
    chain.push({
      stage: "action",
      summary: `Task ${task.status}: ${String(task.goal || "").slice(0, 160)}`,
      detail: task.resultSummary || task.lastError || "",
    });
  }

  if (run) {
    chain.push({
      stage: "action",
      summary: `Workflow run ${run.status} @ step ${run.stepIndex}`,
      detail: (run.stepResults || [])
        .map((s) => `${s.kind || s.stepId}:${s.http?.status ?? s.verify?.ok ?? ""}`)
        .join(" → ")
        .slice(0, 400),
    });
  }

  chain.push({
    stage: "result",
    summary: task
      ? `Task ended ${task.status}${task.evaluation?.score != null ? ` (score ${task.evaluation.score})` : ""}`
      : run
        ? `Workflow ${run.status}${run.error ? `: ${run.error}` : ""}`
        : `${events.length} related events`,
    detail: events
      .slice(-5)
      .map((e) => `${e.type}: ${e.summary || ""}`)
      .join(" | ")
      .slice(0, 500),
  });

  const howHumanWouldConfigure = [
    trigger
      ? `1. Create an Operations trigger “${trigger.name}” of type ${trigger.type} listening for ${trigger.config?.eventType || "events"}.`
      : "1. Decide what event or schedule should start this work (Operations → Triggers).",
    agent
      ? `2. Assign employee “${agent.name}” with standing instructions and success criteria.`
      : "2. Hire or pick an agent with clear instructions.",
    "3. Optionally compile a Workflow (Architect apply) so API GET→map→POST steps are deterministic.",
    "4. Set Policies operating mode + max authority so auto-heal/CEO loop stay inside your risk appetite.",
    "5. Promote workflow draft → sandbox → canary → production after tests pass.",
  ];

  const narrative = chain.map((c) => `${c.stage.toUpperCase()}: ${c.summary}`).join("\n");

  return {
    ok: true,
    correlationId: correlationId || null,
    chain,
    narrative,
    howHumanWouldConfigure,
    learningMode: Boolean(user?.settings?.learningMode),
    refs: {
      task: task
        ? { _id: task._id, status: task.status, agent: task.agent, goalRef: task.goalRef }
        : null,
      run: run
        ? { _id: run._id, status: run.status, definition: run.definition, environment: run.environment }
        : null,
      workflow: def,
      agent,
      trigger,
      goal,
      events: events.map((e) => ({
        type: e.type,
        summary: e.summary,
        at: e.createdAt,
        significance: e.significance,
      })),
      decisions: decisions.map((d) => ({
        decision: d.decision,
        outcome: d.outcome,
        at: d.createdAt,
      })),
      audits: audits.slice(0, 10).map((a) => ({
        action: a.action,
        detail: a.detail,
        at: a.createdAt,
      })),
    },
  };
}

/**
 * Generate an up-to-date SOP markdown from an AI employee (agent) + related artifacts.
 * @param {string} userId
 * @param {string} agentId
 */
export async function generateSopFromAgent(userId, agentId) {
  const agent = await Agent.findOne({ _id: agentId, user: userId }).lean();
  if (!agent) return { ok: false, title: "Missing", detail: "Agent not found" };

  const [goals, triggers, skills, recentTasks] = await Promise.all([
    Goal.find({ user: userId, agent: agentId, status: "active" }).limit(10).lean(),
    Trigger.find({ user: userId, agent: agentId, enabled: true }).limit(10).lean(),
    (await import("../models/Skill.js")).Skill.find({ user: userId, agent: agentId })
      .limit(10)
      .lean(),
    Task.find({ user: userId, agent: agentId })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("status goal resultSummary createdAt")
      .lean(),
  ]);

  const md = [
    `# SOP — ${agent.name}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    `Role: ${agent.role} · Lifecycle: ${agent.lifecycleStatus || "active"} · Authority: ${agent.authorityLevel || "external"}`,
    "",
    "## Purpose",
    String(agent.description || agent.skill || agent.profile || "Execute assigned business work.").slice(0, 2000),
    "",
    "## Standing instructions",
    String(agent.instructions || "(none)").slice(0, 6000),
    "",
    "## Success criteria",
    String(agent.successCriteria || "(none)").slice(0, 2000),
    "",
    "## Goals & KPIs",
    ...(goals.length
      ? goals.map((g) => {
          const kpis = (g.kpis || [])
            .map((k) => `${k.name}: ${k.current}/${k.target ?? "?"} ${k.unit || ""}`)
            .join("; ");
          return `- **${g.title}** — ${String(g.instructions || "").slice(0, 200)}${kpis ? ` _(KPI: ${kpis})_` : ""}`;
        })
      : ["- (no active goals)"]),
    "",
    "## Triggers",
    ...(triggers.length
      ? triggers.map(
          (t) =>
            `- **${t.name}** (${t.type}${t.config?.eventType ? ` / ${t.config.eventType}` : ""}) → ${t.action}`
        )
      : ["- (none)"]),
    "",
    "## Skills / playbooks",
    ...(skills.length
      ? skills.map((s) => `- **${s.name}** \`/${s.slug}\` [${s.status}]`)
      : ["- (none)"]),
    "",
    "## Recent runs",
    ...(recentTasks.length
      ? recentTasks.map(
          (t) =>
            `- ${t.createdAt?.toISOString?.() || ""} · ${t.status}: ${String(t.goal || "").slice(0, 100)}`
        )
      : ["- (none)"]),
    "",
    "## Escalation",
    "On repeated failures, HealController playbooks apply under Policies operating mode. Manager escalation triggers (if hired via department) listen for `agent.failed`.",
    "",
  ].join("\n");

  return {
    ok: true,
    agentId: String(agent._id),
    agentName: agent.name,
    sopMarkdown: md,
  };
}
