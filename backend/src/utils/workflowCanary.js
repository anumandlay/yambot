/**
 * @fileoverview Sandbox → Canary → Production promotion + automatic rollback.
 * Purpose: Safe release ladder for WorkflowDefinitions with failure-rate rollback.
 * Downstream: /api/workflows promote|rollback, scheduler tickCanaryMonitor.
 */

import { WorkflowDefinition, WorkflowRun, WORKFLOW_ENVIRONMENTS } from "../models/WorkflowDefinition.js";
import { Goal } from "../models/Goal.js";
import { runWorkflowTestSuite } from "./workflowTests.js";
import { BusinessBlueprint } from "../models/BusinessBlueprint.js";
import { recordDecision } from "../models/DecisionJournal.js";
import { emitEvent } from "./eventBus.js";
import { writeAudit } from "./audit.js";

const PROMOTE_ORDER = ["draft", "sandbox", "canary", "production"];

/**
 * Snapshot current definition for rollback.
 * @param {import('mongoose').Document} def
 * @returns {object}
 */
function snapshotDef(def) {
  return {
    environment: def.environment,
    version: def.version,
    steps: def.steps,
    handoffs: def.handoffs,
    incidentPolicy: def.incidentPolicy,
    agentKeyToId: def.agentKeyToId,
    at: new Date().toISOString(),
  };
}

/**
 * Promote a workflow one step (or to an explicit target) on the release ladder.
 * @param {string} userId
 * @param {string} definitionId
 * @param {{ to?: string, skipTests?: boolean }} [opts]
 */
export async function promoteWorkflow(userId, definitionId, opts = {}) {
  const def = await WorkflowDefinition.findOne({ _id: definitionId, user: userId });
  if (!def) return { ok: false, title: "Missing", detail: "Workflow not found" };

  const current = def.environment || "draft";
  const idx = PROMOTE_ORDER.indexOf(current);
  let target = String(opts.to || "").trim();
  if (!target) {
    target = PROMOTE_ORDER[Math.min(idx + 1, PROMOTE_ORDER.length - 1)];
  }
  if (!WORKFLOW_ENVIRONMENTS.includes(target)) {
    return { ok: false, title: "Bad target", detail: `Unknown environment ${target}` };
  }
  const targetIdx = PROMOTE_ORDER.indexOf(target);
  if (targetIdx < 0 || targetIdx <= idx) {
    return {
      ok: false,
      title: "Cannot promote",
      detail: `Already at ${current}; cannot move to ${target}. Use rollback to go back.`,
    };
  }

  // Why: production requires recent sandbox tests green — canary is the live bake.
  if (target === "production" || target === "canary") {
    if (!opts.skipTests) {
      let blueprintDoc = null;
      if (def.blueprintId) {
        blueprintDoc = await BusinessBlueprint.findOne({
          _id: def.blueprintId,
          user: userId,
        });
      }
      const suite = await runWorkflowTestSuite(userId, String(def._id), { blueprintDoc });
      if (!suite.ok || suite.blockingFailed) {
        return {
          ok: false,
          title: "Tests blocked promote",
          detail: suite.detail || "Sandbox suite has critical failures.",
          suite,
        };
      }
    }
  }

  def.rollbackSnapshot = snapshotDef(def);
  def.environment = target;
  def.version = (def.version || 1) + 1;
  if (target === "canary") {
    def.canaryStartedAt = new Date();
  }
  if (target === "production") {
    def.canaryStartedAt = null;
  }
  await def.save();

  await recordDecision(userId, {
    actorType: "system",
    authorityLevel: "internal",
    decision: `Promoted workflow “${def.name}” ${current} → ${target}`,
    rationale: "Release ladder promote",
    context: { definitionId: String(def._id), from: current, to: target, version: def.version },
    outcome: "promoted",
    approved: true,
  }).catch(() => {});

  await writeAudit({
    userId,
    action: "workflow.promoted",
    detail: `${def.name}: ${current} → ${target}`,
    meta: { definitionId: String(def._id), to: target },
  }).catch(() => {});

  await emitEvent({
    userId,
    type: "workflow.promoted",
    source: "workflow",
    summary: `${def.name} → ${target}`,
    payload: { definitionId: String(def._id), from: current, to: target },
  });

  return { ok: true, workflow: def };
}

/**
 * Roll a workflow back to its rollbackSnapshot (or to an explicit environment).
 * @param {string} userId
 * @param {string} definitionId
 * @param {{ reason?: string, to?: string }} [opts]
 */
export async function rollbackWorkflow(userId, definitionId, opts = {}) {
  const def = await WorkflowDefinition.findOne({ _id: definitionId, user: userId });
  if (!def) return { ok: false, title: "Missing", detail: "Workflow not found" };

  const snap = def.rollbackSnapshot;
  const from = def.environment;
  if (opts.to && WORKFLOW_ENVIRONMENTS.includes(opts.to)) {
    def.environment = opts.to;
  } else if (snap && typeof snap === "object") {
    if (Array.isArray(snap.steps)) def.steps = snap.steps;
    if (Array.isArray(snap.handoffs)) def.handoffs = snap.handoffs;
    if (snap.incidentPolicy) def.incidentPolicy = snap.incidentPolicy;
    if (snap.agentKeyToId) def.agentKeyToId = snap.agentKeyToId;
    def.environment = snap.environment || "sandbox";
  } else {
    // Why: no snapshot — demote one rung on the ladder.
    const idx = PROMOTE_ORDER.indexOf(def.environment || "production");
    def.environment = PROMOTE_ORDER[Math.max(0, idx - 1)];
  }
  def.canaryStartedAt = null;
  def.version = (def.version || 1) + 1;
  await def.save();

  await recordDecision(userId, {
    actorType: "system",
    authorityLevel: "internal",
    decision: `Rolled back workflow “${def.name}” ${from} → ${def.environment}`,
    rationale: opts.reason || "Manual or automatic canary rollback",
    context: { definitionId: String(def._id), from, to: def.environment },
    outcome: "rolled_back",
    approved: true,
  }).catch(() => {});

  await emitEvent({
    userId,
    type: "workflow.rolled_back",
    source: "workflow",
    significance: "high",
    summary: `${def.name} rolled back to ${def.environment}`,
    payload: { definitionId: String(def._id), reason: opts.reason || "" },
  });

  return { ok: true, workflow: def };
}

/**
 * Auto-rollback canary workflows whose recent failure rate exceeds threshold.
 * @returns {Promise<{ checked: number, rolledBack: number }>}
 */
export async function tickCanaryMonitor() {
  const canaries = await WorkflowDefinition.find({
    active: true,
    environment: "canary",
  }).limit(40);

  let rolledBack = 0;
  for (const def of canaries) {
    const since = def.canaryStartedAt || new Date(Date.now() - 24 * 60 * 60 * 1000);
    const runs = await WorkflowRun.find({
      definition: def._id,
      createdAt: { $gte: since },
      environment: "canary",
      status: { $in: ["succeeded", "failed"] },
    })
      .select("status")
      .limit(50)
      .lean();

    const minSamples = def.canaryMinSamples || 3;
    if (runs.length >= minSamples) {
      const failed = runs.filter((r) => r.status === "failed").length;
      const rate = failed / runs.length;
      const threshold = def.canaryFailureThreshold || 0.4;
      if (rate >= threshold) {
        await rollbackWorkflow(String(def.user), String(def._id), {
          reason: `Canary failure rate ${(rate * 100).toFixed(0)}% ≥ ${(threshold * 100).toFixed(0)}% (${failed}/${runs.length})`,
          to: "sandbox",
        });
        rolledBack += 1;
        continue;
      }
    }

    // KPI deterioration rollback (beyond failure-rate; does not need minSamples)
    if (def.canaryKpiGoalId && def.canaryKpiBaseline != null) {
      const goal = await Goal.findOne({
        _id: def.canaryKpiGoalId,
        user: def.user,
      })
        .select("kpis")
        .lean();
      const kpiName = String(def.canaryKpiName || "").trim();
      const kpi = (goal?.kpis || []).find(
        (k) => !kpiName || String(k.name || "").toLowerCase() === kpiName.toLowerCase()
      );
      if (kpi && kpi.current != null) {
        const baseline = Number(def.canaryKpiBaseline);
        const current = Number(kpi.current);
        const maxDrop = Number(def.canaryKpiMaxDropPct) || 0.15;
        if (baseline > 0 && (baseline - current) / baseline >= maxDrop) {
          await rollbackWorkflow(String(def.user), String(def._id), {
            reason: `Canary KPI “${kpi.name}” dropped ${(((baseline - current) / baseline) * 100).toFixed(0)}% from baseline ${baseline} → ${current}`,
            to: "sandbox",
          });
          rolledBack += 1;
        }
      }
    }
  }
  return { checked: canaries.length, rolledBack };
}
