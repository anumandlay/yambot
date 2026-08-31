/**
 * @fileoverview Business outcome attribution — which employee/workflow moved KPIs.
 * Purpose: Explain “revenue +14%” with contributor weights for CEO learning.
 * Downstream: /api/ceo/attribution, causalMemory, Command Center.
 */

import { Goal } from "../models/Goal.js";
import { Task } from "../models/Task.js";
import { Agent } from "../models/Agent.js";
import { WorkflowRun } from "../models/WorkflowDefinition.js";
import { DecisionJournal } from "../models/DecisionJournal.js";

/**
 * Attribute recent KPI movement to agents / workflows / decisions.
 * @param {string} userId
 * @param {{ goalId?: string, sinceDays?: number }} [opts]
 */
export async function attributeOutcomes(userId, opts = {}) {
  const sinceDays = Math.min(90, Math.max(1, Number(opts.sinceDays) || 14));
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60_000);

  const goalFilter = { user: userId, status: "active" };
  if (opts.goalId) goalFilter._id = opts.goalId;
  const goals = await Goal.find(goalFilter).limit(20).lean();

  /** @type {object[]} */
  const attributions = [];

  for (const g of goals) {
    const kpis = g.kpis || [];
    if (!kpis.length) continue;

    const tasks = await Task.find({
      user: userId,
      goalRef: g._id,
      status: "done",
      completedAt: { $gte: since },
    })
      .select("agent resultSummary evaluation llmUsage completedAt")
      .limit(100)
      .lean();

    const byAgent = new Map();
    for (const t of tasks) {
      const id = String(t.agent || "unknown");
      const row = byAgent.get(id) || { runs: 0, scoreSum: 0, spend: 0 };
      row.runs += 1;
      row.scoreSum += Number(t.evaluation?.score) || 50;
      row.spend += Number(t.llmUsage?.estimatedUsd) || 0;
      byAgent.set(id, row);
    }

    const agentIds = [...byAgent.keys()].filter((id) => id !== "unknown");
    const agents = await Agent.find({ _id: { $in: agentIds } })
      .select("name")
      .lean();
    const nameById = Object.fromEntries(agents.map((a) => [String(a._id), a.name]));

    const totalRuns = [...byAgent.values()].reduce((s, r) => s + r.runs, 0) || 1;
    const contributors = [...byAgent.entries()].map(([agentId, row]) => {
      const weight = row.runs / totalRuns;
      return {
        agentId,
        name: nameById[agentId] || agentId,
        runs: row.runs,
        avgScore: Math.round(row.scoreSum / Math.max(1, row.runs)),
        spendUsd: Math.round(row.spend * 1000) / 1000,
        contributionPct: Math.round(weight * 100),
      };
    });
    contributors.sort((a, b) => b.contributionPct - a.contributionPct);

    const wfRuns = await WorkflowRun.countDocuments({
      user: userId,
      status: "succeeded",
      createdAt: { $gte: since },
    });

    const decisions = await DecisionJournal.find({
      user: userId,
      createdAt: { $gte: since },
      "context.goalId": String(g._id),
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean()
      .catch(() => []);

    attributions.push({
      goalId: String(g._id),
      title: g.title,
      kpis: kpis.map((k) => ({
        name: k.name,
        current: k.current,
        target: k.target,
        unit: k.unit,
        gapPct:
          k.target != null && Number(k.target) !== 0
            ? Math.round(((Number(k.current) - Number(k.target)) / Number(k.target)) * 100)
            : null,
      })),
      contributors,
      workflowSuccesses: wfRuns,
      relatedDecisions: decisions.map((d) => ({
        decision: d.decision,
        outcome: d.outcome,
        at: d.createdAt,
      })),
      narrative: contributors.length
        ? `Goal “${g.title}”: top contributor ${contributors[0].name} (${contributors[0].contributionPct}% of successful runs).`
        : `Goal “${g.title}”: no attributed successful runs in ${sinceDays}d.`,
    });
  }

  return {
    ok: true,
    since: since.toISOString(),
    attributions,
  };
}
