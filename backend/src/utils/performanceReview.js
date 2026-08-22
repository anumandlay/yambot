/**
 * @fileoverview Performance review generator — periodic employee reviews.
 * Purpose: Auto-build performance summaries from task metrics (vision item #17).
 * Downstream: scheduler weekly tick, governance API.
 */

import { Agent } from "../models/Agent.js";
import { Task } from "../models/Task.js";
import { PerformanceReview } from "../models/PerformanceReview.js";

/**
 * @param {string} userId
 * @param {string} agentId
 * @param {number} [periodDays]
 */
export async function generatePerformanceReview(userId, agentId, periodDays = 30) {
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
  const match = {
    user: userId,
    agent: agentId,
    completedAt: { $gte: since },
    status: { $in: ["done", "error"] },
  };

  const tasks = await Task.find(match).select("status evaluation llmUsage claimedAt completedAt").lean();
  const completed = tasks.filter((t) => t.status === "done").length;
  const total = tasks.length || 1;
  const successRate = Math.round((completed / total) * 1000) / 10;
  const scores = tasks.map((t) => t.evaluation?.score).filter((s) => s != null);
  const avgScore = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;
  const totalTokens = tasks.reduce((a, t) => a + (t.llmUsage?.totalTokens || 0), 0);
  const estimatedUsd = tasks.reduce((a, t) => a + (t.llmUsage?.estimatedUsd || 0), 0);
  const durations = tasks
    .filter((t) => t.claimedAt && t.completedAt)
    .map((t) => (new Date(t.completedAt).getTime() - new Date(t.claimedAt).getTime()) / 1000);
  const avgDurationSec = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  const agent = await Agent.findOne({ _id: agentId, user: userId }).select("name skill").lean();
  const strengths = [];
  const weaknesses = [];
  const recommendations = [];

  if (successRate >= 90) strengths.push("High task success rate");
  else weaknesses.push("Success rate below 90%");
  if (avgScore >= 75) strengths.push("Strong evaluation scores");
  else if (avgScore > 0) weaknesses.push("Evaluation scores need improvement");
  if (estimatedUsd > 5) weaknesses.push("LLM spend elevated for period");
  if (avgDurationSec > 600) weaknesses.push("Long average task duration");

  if (weaknesses.includes("Evaluation scores need improvement")) {
    recommendations.push("Review failed trajectories and add site memory hints");
  }
  if (weaknesses.includes("LLM spend elevated for period")) {
    recommendations.push("Tighten monthly budget or simplify standing instructions");
  }
  recommendations.push("Record a human demonstration for repeated workflows");

  const summary = [
    `PERFORMANCE REVIEW — ${agent?.name || "Agent"}`,
    `Period: last ${periodDays} days`,
    `Tasks: ${total} (${successRate}% success)`,
    `Avg evaluation: ${avgScore}/100`,
    `Est. cost: $${estimatedUsd.toFixed(4)}`,
  ].join("\n");

  return PerformanceReview.create({
    user: userId,
    agent: agentId,
    periodDays,
    summary,
    metrics: {
      tasksCompleted: completed,
      successRate,
      avgEvaluationScore: avgScore,
      totalTokens,
      estimatedUsd: Number(estimatedUsd.toFixed(4)),
      escalationRate: 0,
      avgDurationSec,
    },
    strengths,
    weaknesses,
    recommendations,
  });
}

/**
 * @returns {Promise<{ generated: number }>}
 */
export async function tickPerformanceReviews() {
  const agents = await Agent.find({ active: { $ne: false } }).select("user _id").limit(50);
  let generated = 0;
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  for (const agent of agents) {
    const recent = await PerformanceReview.findOne({
      user: agent.user,
      agent: agent._id,
      createdAt: { $gte: weekAgo },
    });
    if (recent) continue;
    try {
      await generatePerformanceReview(String(agent.user), String(agent._id));
      generated += 1;
    } catch (err) {
      console.error(`[performanceReview] agent ${agent._id}:`, err?.message || err);
    }
  }
  return { generated };
}
