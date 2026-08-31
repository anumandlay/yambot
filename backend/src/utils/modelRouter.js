/**
 * @fileoverview Automatic LLM model routing by complexity, errors, cost, and risk.
 * Purpose: Move beyond static suggestions — score each agent and assign best tier profile.
 * Downstream: optimizeModelCosts, tickModelRouting, CEO pulse apply.
 */

import mongoose from "mongoose";
import { LlmProfile } from "../models/LlmProfile.js";
import { Agent } from "../models/Agent.js";
import { Task } from "../models/Task.js";
import { User } from "../models/User.js";
import { CompanyMemory } from "../models/CompanyMemory.js";
import { recordDecision } from "../models/DecisionJournal.js";

/**
 * @param {string|import("mongoose").Types.ObjectId} id
 */
function asObjectId(id) {
  if (id instanceof mongoose.Types.ObjectId) return id;
  return new mongoose.Types.ObjectId(String(id));
}

/**
 * Infer tier from profile fields / model name.
 * @param {object} p
 * @returns {"cheap"|"standard"|"premium"}
 */
export function effectiveTier(p) {
  const t = String(p?.tier || "standard");
  if (t === "cheap" || t === "premium") return t;
  const m = `${p?.model || ""} ${p?.name || ""}`.toLowerCase();
  if (/haiku|mini|flash|nano|cheap|3\.5-turbo|gpt-4o-mini|ministral/.test(m)) return "cheap";
  if (/opus|sonnet-4|gpt-4(?!o-mini)|o1|o3|premium|claude-3-opus/.test(m)) return "premium";
  return "standard";
}

/**
 * Score how complex an agent's standing work is (0–100).
 * @param {object} agent
 * @param {{ errorRate?: number, avgTokens?: number, goalText?: string }} [ctx]
 */
export function scoreComplexity(agent, ctx = {}) {
  const blob = `${agent?.skill || ""} ${agent?.instructions || ""} ${agent?.successCriteria || ""} ${ctx.goalText || ""}`.toLowerCase();
  let score = 35;
  if (/research|strateg|negotiat|plan|architect|diagnos|multi.?step|browser|captcha|vision/.test(blob)) {
    score += 35;
  }
  if (/classif|extract|summar|label|tag|status|template|copy.?paste|simple/.test(blob)) {
    score -= 20;
  }
  if (/financ|invoice|payment|legal|compliance|critical/.test(blob)) {
    score += 15; // risk bump → prefer stronger models
  }
  if ((ctx.errorRate || 0) > 0.25) score += 20;
  if ((ctx.errorRate || 0) > 0.4) score += 10;
  if ((ctx.avgTokens || 0) > 8000) score += 10;
  return Math.max(0, Math.min(100, score));
}

/**
 * Choose target tier from complexity score.
 * @param {number} complexity
 * @returns {"cheap"|"standard"|"premium"}
 */
export function tierForComplexity(complexity) {
  if (complexity >= 70) return "premium";
  if (complexity <= 40) return "cheap";
  return "standard";
}

/**
 * Pick cheapest profile in a tier (by costPer1kUsd, then name).
 * @param {object[]} profiles
 * @param {"cheap"|"standard"|"premium"} tier
 */
export function pickProfileForTier(profiles, tier) {
  const pool = profiles.filter((p) => effectiveTier(p) === tier);
  if (!pool.length) {
    // Fallback ladder
    const order =
      tier === "premium"
        ? ["premium", "standard", "cheap"]
        : tier === "cheap"
          ? ["cheap", "standard", "premium"]
          : ["standard", "cheap", "premium"];
    for (const t of order) {
      const alt = profiles.filter((p) => effectiveTier(p) === t);
      if (alt.length) {
        return alt.sort(
          (a, b) => (Number(a.costPer1kUsd) || 0) - (Number(b.costPer1kUsd) || 0)
        )[0];
      }
    }
    return null;
  }
  return pool.sort((a, b) => (Number(a.costPer1kUsd) || 0) - (Number(b.costPer1kUsd) || 0))[0];
}

/**
 * Build routing suggestions with scored complexity / savings.
 * @param {string} userId
 */
export async function buildModelRoutingPlan(userId) {
  const [profiles, agents, usage] = await Promise.all([
    LlmProfile.find({ user: userId }).lean(),
    Agent.find({ user: userId, active: { $ne: false } })
      .select("name skill instructions successCriteria llm lifecycleStatus authorityLevel")
      .limit(80)
      .lean(),
    Task.aggregate([
      {
        $match: {
          user: asObjectId(userId),
          createdAt: { $gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
        },
      },
      {
        $group: {
          _id: "$agent",
          runs: { $sum: 1 },
          errors: { $sum: { $cond: [{ $eq: ["$status", "error"] }, 1, 0] } },
          avgTokens: { $avg: "$llmUsage.totalTokens" },
          avgCost: { $avg: "$llmUsage.estimatedUsd" },
        },
      },
    ]),
  ]);

  const usageByAgent = Object.fromEntries(
    usage.map((u) => [
      String(u._id),
      {
        runs: u.runs,
        errors: u.errors,
        errorRate: u.runs ? u.errors / u.runs : 0,
        avgTokens: u.avgTokens || 0,
        avgCost: u.avgCost || 0,
      },
    ])
  );

  /** @type {object[]} */
  const suggestions = [];
  for (const a of agents) {
    if (a.lifecycleStatus === "retired" || a.lifecycleStatus === "paused") continue;
    const u = usageByAgent[String(a._id)] || {
      runs: 0,
      errors: 0,
      errorRate: 0,
      avgTokens: 0,
      avgCost: 0,
    };
    const complexity = scoreComplexity(a, u);
    const wantTier = tierForComplexity(complexity);
    const target = pickProfileForTier(profiles, wantTier);
    if (!target) continue;
    const currentProfileId = a.llm?.profile ? String(a.llm.profile) : "";
    if (String(target._id) === currentProfileId) continue;

    const current = profiles.find((p) => String(p._id) === currentProfileId);
    const currentTier = current ? effectiveTier(current) : "none";
    const targetTier = effectiveTier(target);
    const costNow = Number(current?.costPer1kUsd) || 0;
    const costNew = Number(target.costPer1kUsd) || 0;
    let estimatedSavingsPct = 0;
    if (costNow > 0 && costNew < costNow) {
      estimatedSavingsPct = Math.round(((costNow - costNew) / costNow) * 100);
    } else if (targetTier === "cheap" && currentTier !== "cheap") {
      estimatedSavingsPct = 30;
    }

    suggestions.push({
      agentId: String(a._id),
      agentName: a.name,
      action:
        targetTier === "cheap"
          ? "use_cheap"
          : targetTier === "premium"
            ? "use_premium"
            : "assign_profile",
      profileId: String(target._id),
      profileName: target.name,
      complexity,
      wantTier: targetTier,
      currentTier,
      errorRate: Math.round(u.errorRate * 100) / 100,
      avgCost: Math.round((u.avgCost || 0) * 10000) / 10000,
      reason: `Complexity ${complexity}/100 → ${targetTier} (${target.name}). Errors ${Math.round(u.errorRate * 100)}% over ${u.runs} runs.`,
      estimatedSavingsPct,
      autoSafe: targetTier !== "premium" || u.errorRate >= 0.25,
    });
  }

  suggestions.sort((x, y) => (y.estimatedSavingsPct || 0) - (x.estimatedSavingsPct || 0));

  return {
    ok: true,
    profiles: profiles.map((p) => ({
      _id: String(p._id),
      name: p.name,
      model: p.model,
      tier: effectiveTier(p),
      costPer1kUsd: Number(p.costPer1kUsd) || 0,
    })),
    suggestions: suggestions.slice(0, 40),
    summary: {
      profileCount: profiles.length,
      suggestionCount: suggestions.length,
      potentialSavingsAgents: suggestions.filter((s) => s.estimatedSavingsPct > 0).length,
    },
  };
}

/**
 * Apply a single route to an agent.
 * @param {string} userId
 * @param {{ agentId: string, profileId: string, reason?: string }} opts
 */
export async function applyModelRoute(userId, opts) {
  const agent = await Agent.findOne({ _id: opts.agentId, user: userId });
  const profile = await LlmProfile.findOne({ _id: opts.profileId, user: userId });
  if (!agent || !profile) {
    return { ok: false, title: "Missing", detail: "Agent or LLM profile not found." };
  }
  agent.llm = agent.llm || {};
  agent.llm.useCustom = true;
  agent.llm.profile = profile._id;
  await agent.save();
  await recordDecision(userId, {
    actorType: "system",
    authorityLevel: "internal",
    decision: `Model route ${agent.name} → “${profile.name}”`,
    rationale: opts.reason || "Automatic model routing",
    context: { agentId: String(agent._id), profileId: String(profile._id) },
    outcome: "applied",
    approved: true,
  }).catch(() => {});
  return { ok: true, detail: `${agent.name} → ${profile.name}` };
}

/**
 * Scheduler: auto-apply safe cheap/standard routes when operatingMode allows.
 * @returns {Promise<{ users: number, applied: number }>}
 */
export async function tickModelRouting() {
  const users = await User.find({
    "settings.operatingMode": { $in: ["autonomous", "autopilot"] },
  })
    .select("_id settings")
    .limit(60)
    .lean();

  let applied = 0;
  for (const u of users) {
    const userId = String(u._id);
    const last = await CompanyMemory.findOne({ user: userId, key: "model_route_last" }).lean();
    if (last?.value) {
      const t = Date.parse(last.value);
      if (Number.isFinite(t) && Date.now() - t < 6 * 60 * 60_000) continue;
    }
    const plan = await buildModelRoutingPlan(userId);
    for (const s of (plan.suggestions || []).filter((x) => x.autoSafe).slice(0, 5)) {
      const res = await applyModelRoute(userId, {
        agentId: s.agentId,
        profileId: s.profileId,
        reason: s.reason,
      });
      if (res.ok) applied += 1;
    }
    await CompanyMemory.findOneAndUpdate(
      { user: userId, key: "model_route_last" },
      {
        user: userId,
        key: "model_route_last",
        value: new Date().toISOString(),
        category: "system",
        source: "model_router",
      },
      { upsert: true }
    ).catch(() => {});
  }
  return { users: users.length, applied };
}
