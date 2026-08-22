/**
 * @fileoverview Improvement proposal generator — autonomous improvement loop seed.
 * Purpose: Analyze failures and propose workflow optimizations (vision #16).
 * Downstream: scheduler, governance improvements API.
 */

import { Task } from "../models/Task.js";
import { ImprovementProposal } from "../models/ImprovementProposal.js";

/**
 * @returns {Promise<{ created: number }>}
 */
export async function tickImprovementProposals() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const failures = await Task.aggregate([
    {
      $match: {
        status: "error",
        completedAt: { $gte: since },
        agent: { $ne: null },
      },
    },
    {
      $group: {
        _id: { user: "$user", agent: "$agent" },
        count: { $sum: 1 },
        samples: { $push: { error: "$lastError", goal: "$goal" } },
      },
    },
    { $match: { count: { $gte: 3 } } },
    { $limit: 20 },
  ]);

  let created = 0;
  for (const row of failures) {
    const userId = row._id.user;
    const agentId = row._id.agent;
    const existing = await ImprovementProposal.findOne({
      user: userId,
      agent: agentId,
      status: "proposed",
      createdAt: { $gte: since },
    });
    if (existing) continue;

    const sample = row.samples?.[0] || {};
    await ImprovementProposal.create({
      user: userId,
      agent: agentId,
      title: `Reduce failures on agent (${row.count} errors / 7d)`,
      currentState: `Repeated errors: ${String(sample.error || "unknown").slice(0, 200)}`,
      proposedState: "Add site memory hints, simplify instructions, or record a demonstration skill",
      expectedImpact: "~30% fewer failures on similar goals",
      risk: "low",
      evidence: { failureCount: row.count, sample },
    });
    created += 1;
  }
  return { created };
}
