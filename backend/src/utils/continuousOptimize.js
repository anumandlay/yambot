/**
 * @fileoverview Continuous optimization — propose → experiment → measure → promote/rollback.
 * Purpose: Close the A/B loop for underperforming agents/workflows under operatingMode.
 * Downstream: scheduler tickContinuousOptimize, improvements API.
 */

import { Task } from "../models/Task.js";
import { ImprovementProposal } from "../models/ImprovementProposal.js";
import { User } from "../models/User.js";
import { CompanyMemory } from "../models/CompanyMemory.js";
import { recordDecision } from "../models/DecisionJournal.js";
import { applyHeal } from "./healController.js";

/**
 * Snapshot recent success metrics for an agent.
 * @param {string} userId
 * @param {string} agentId
 * @param {Date} since
 */
async function agentMetrics(userId, agentId, since) {
  const rows = await Task.find({
    user: userId,
    agent: agentId,
    status: { $in: ["done", "error"] },
    completedAt: { $gte: since },
  })
    .select("status llmUsage.estimatedUsd")
    .limit(100)
    .lean();
  const done = rows.filter((r) => r.status === "done").length;
  const failed = rows.filter((r) => r.status === "error").length;
  const spend = rows.reduce((s, r) => s + (Number(r.llmUsage?.estimatedUsd) || 0), 0);
  const total = done + failed;
  return {
    runs: total,
    successRate: total ? done / total : 0,
    failRate: total ? failed / total : 0,
    spendUsd: Math.round(spend * 1000) / 1000,
  };
}

/**
 * Auto-start experiments for low-risk proposed improvements.
 * @param {string} userId
 */
async function autoStartExperiments(userId) {
  const proposals = await ImprovementProposal.find({
    user: userId,
    status: "proposed",
    risk: { $in: ["low", "medium"] },
  })
    .sort({ createdAt: -1 })
    .limit(5);

  let started = 0;
  for (const p of proposals) {
    if (!p.agent) continue;
    const before = await agentMetrics(
      userId,
      String(p.agent),
      new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    );
    p.status = "testing";
    p.experimentStartedAt = new Date();
    p.metricsBefore = before;
    p.hypothesis =
      p.hypothesis ||
      `Improving ${p.title} should raise success rate vs baseline ${Math.round(before.successRate * 100)}%.`;
    p.variantA = p.variantA || p.currentState || "current";
    p.variantB = p.variantB || p.proposedState || "proposed fix";
    p.trafficSplit = p.trafficSplit || 50;
    await p.save();

    // Apply a light heal as "variant B" treatment when agent-linked.
    await applyHeal(userId, {
      agentId: String(p.agent),
      errorHint: String(p.currentState || p.title).slice(0, 400),
      auto: true,
    }).catch(() => null);

    await recordDecision(userId, {
      actorType: "system",
      authorityLevel: "internal",
      decision: `Auto-started experiment: ${p.title}`,
      rationale: p.hypothesis,
      context: { proposalId: String(p._id), metricsBefore: before },
      outcome: "testing",
      approved: true,
    }).catch(() => {});
    started += 1;
  }
  return started;
}

/**
 * Resolve testing experiments older than min window with enough samples.
 * @param {string} userId
 * @param {{ minHours?: number, minRuns?: number }} [opts]
 */
async function resolveExperiments(userId, opts = {}) {
  const minHours = Number(opts.minHours) || 24;
  const minRuns = Number(opts.minRuns) || 5;
  const cutoff = new Date(Date.now() - minHours * 60 * 60 * 1000);

  const testing = await ImprovementProposal.find({
    user: userId,
    status: "testing",
    experimentStartedAt: { $lte: cutoff },
  }).limit(10);

  let promoted = 0;
  let rolledBack = 0;
  for (const p of testing) {
    if (!p.agent) {
      p.status = "rejected";
      p.experimentEndedAt = new Date();
      await p.save();
      rolledBack += 1;
      continue;
    }
    const after = await agentMetrics(userId, String(p.agent), p.experimentStartedAt);
    p.metricsAfter = after;
    p.experimentEndedAt = new Date();

    const beforeRate = Number(p.metricsBefore?.successRate) || 0;
    const afterRate = Number(after.successRate) || 0;
    const enough = after.runs >= minRuns;

    // Promote if success improved by ≥5pp or fail rate dropped meaningfully
    const win = enough && afterRate >= beforeRate + 0.05;
    const lose = enough && afterRate < beforeRate - 0.05;

    if (win) {
      p.status = "deployed";
      promoted += 1;
      await recordDecision(userId, {
        actorType: "system",
        authorityLevel: "internal",
        decision: `Promoted experiment: ${p.title}`,
        rationale: `Success ${Math.round(beforeRate * 100)}% → ${Math.round(afterRate * 100)}% (${after.runs} runs)`,
        context: {
          proposalId: String(p._id),
          metricsBefore: p.metricsBefore,
          metricsAfter: after,
        },
        outcome: "deployed",
        approved: true,
      }).catch(() => {});
    } else if (lose || (enough && !win)) {
      p.status = "rejected";
      rolledBack += 1;
      // Soft rollback: leave heal patches but journal rejection; canary workflows use workflowCanary.
      await recordDecision(userId, {
        actorType: "system",
        authorityLevel: "internal",
        decision: `Rolled back experiment: ${p.title}`,
        rationale: enough
          ? `Success ${Math.round(beforeRate * 100)}% → ${Math.round(afterRate * 100)}%`
          : "Insufficient improvement",
        context: { proposalId: String(p._id), metricsAfter: after },
        outcome: "rejected",
        approved: true,
      }).catch(() => {});
    } else {
      // Not enough samples yet — keep testing
      p.experimentEndedAt = null;
      await p.save();
      continue;
    }
    await p.save();
  }
  return { promoted, rolledBack };
}

/**
 * Full continuous optimization tick for one user.
 * @param {string} userId
 */
export async function runContinuousOptimize(userId) {
  const started = await autoStartExperiments(userId);
  const resolved = await resolveExperiments(userId);
  return {
    ok: true,
    experimentsStarted: started,
    ...resolved,
  };
}

/**
 * Scheduler entry — autonomous/autopilot accounts only.
 * @returns {Promise<{ users: number, promoted: number, started: number }>}
 */
export async function tickContinuousOptimize() {
  // Always generate proposals for everyone (existing behavior via tickImprovementProposals in scheduler).
  // Auto start/resolve only for autonomous modes.
  const users = await User.find({
    "settings.operatingMode": { $in: ["autonomous", "autopilot"] },
  })
    .select("_id")
    .limit(40)
    .lean();

  let promoted = 0;
  let started = 0;
  for (const u of users) {
    const userId = String(u._id);
    const last = await CompanyMemory.findOne({ user: userId, key: "optimize_last" }).lean();
    if (last?.value) {
      const t = Date.parse(last.value);
      if (Number.isFinite(t) && Date.now() - t < 12 * 60 * 60_000) continue;
    }
    try {
      const res = await runContinuousOptimize(userId);
      promoted += res.promoted || 0;
      started += res.experimentsStarted || 0;
    } catch (err) {
      console.error(`[continuousOptimize] ${userId}:`, err?.message || err);
    }
    await CompanyMemory.findOneAndUpdate(
      { user: userId, key: "optimize_last" },
      {
        user: userId,
        key: "optimize_last",
        value: new Date().toISOString(),
        category: "system",
        source: "continuous_optimize",
      },
      { upsert: true }
    ).catch(() => {});
  }
  return { users: users.length, promoted, started };
}
