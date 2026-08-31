/**
 * @fileoverview Cost + autonomous-loop runaway protection.
 * Purpose: Hard ceilings so CEO/optimize/heal cannot thrash or burn budget.
 * Downstream: enqueueTask, ceoAutonomy, continuousOptimize, worker claim.
 */

import mongoose from "mongoose";
import { Task } from "../models/Task.js";
import { User } from "../models/User.js";
import { CompanyMemory } from "../models/CompanyMemory.js";
import { DecisionJournal } from "../models/DecisionJournal.js";
import { ImprovementProposal } from "../models/ImprovementProposal.js";

/**
 * @param {string} userId
 * @returns {import("mongoose").Types.ObjectId}
 */
function oid(userId) {
  return new mongoose.Types.ObjectId(String(userId));
}

/**
 * Sum estimated LLM spend for a user since a date.
 * @param {string} userId
 * @param {Date} since
 */
export async function sumSpendUsd(userId, since) {
  const rows = await Task.aggregate([
    { $match: { user: oid(userId), createdAt: { $gte: since } } },
    { $group: { _id: null, spend: { $sum: { $ifNull: ["$llmUsage.estimatedUsd", 0] } } } },
  ]);
  return Number(rows[0]?.spend) || 0;
}

/**
 * Check company / daily / monthly spend ceilings.
 * @param {string} userId
 */
export async function checkCostCeiling(userId) {
  const user = await User.findById(userId).select("settings").lean();
  const s = user?.settings || {};
  const dailyCap = Number(s.companyDailyBudgetUsd || s.dailyBudgetUsd) || 0;
  const monthlyCap = Number(s.companyMonthlyBudgetUsd || s.monthlyBudgetUsd) || 0;
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(dayStart.getFullYear(), dayStart.getMonth(), 1);

  const dailySpend = dailyCap > 0 ? await sumSpendUsd(userId, dayStart) : 0;
  const monthlySpend = monthlyCap > 0 ? await sumSpendUsd(userId, monthStart) : 0;

  if (dailyCap > 0 && dailySpend >= dailyCap) {
    return {
      ok: false,
      detail: `Daily AI budget exhausted ($${dailySpend.toFixed(2)} / $${dailyCap}).`,
      dailySpend,
      monthlySpend,
    };
  }
  if (monthlyCap > 0 && monthlySpend >= monthlyCap) {
    return {
      ok: false,
      detail: `Monthly AI budget exhausted ($${monthlySpend.toFixed(2)} / $${monthlyCap}).`,
      dailySpend,
      monthlySpend,
    };
  }
  return { ok: true, dailySpend, monthlySpend };
}

/**
 * CEO decision frequency + oscillation / duplicate guards.
 * @param {string} userId
 */
export async function checkCeoLoopGuard(userId) {
  const user = await User.findById(userId).select("settings").lean();
  const maxPerHour = Number(user?.settings?.maxCeoDecisionsPerHour) || 20;
  const since = new Date(Date.now() - 60 * 60_000);
  const count = await DecisionJournal.countDocuments({
    user: userId,
    actorType: { $in: ["ceo", "system"] },
    createdAt: { $gte: since },
  });
  if (count >= maxPerHour) {
    return {
      ok: false,
      detail: `CEO decision rate limit (${count}/${maxPerHour} per hour). Cooldown required.`,
    };
  }

  const recent = await DecisionJournal.find({
    user: userId,
    createdAt: { $gte: new Date(Date.now() - 6 * 60 * 60_000) },
  })
    .sort({ createdAt: -1 })
    .limit(30)
    .select("decision")
    .lean();
  const freq = new Map();
  for (const d of recent) {
    const key = String(d.decision || "").slice(0, 120);
    if (!key) continue;
    freq.set(key, (freq.get(key) || 0) + 1);
    if (freq.get(key) >= 3) {
      return {
        ok: false,
        detail: `Oscillation detected: repeated decision “${key.slice(0, 80)}”.`,
      };
    }
  }
  return { ok: true, decisionsLastHour: count };
}

/**
 * Cap concurrent A/B experiments.
 * @param {string} userId
 */
export async function checkExperimentBudget(userId) {
  const user = await User.findById(userId).select("settings").lean();
  const max = Number(user?.settings?.maxConcurrentExperiments) || 3;
  const testing = await ImprovementProposal.countDocuments({
    user: userId,
    status: "testing",
  });
  if (testing >= max) {
    return {
      ok: false,
      detail: `Max concurrent experiments (${testing}/${max}). Finish or rollback before starting more.`,
    };
  }
  return { ok: true, testing };
}

/**
 * Persist a cooldown key in CompanyMemory.
 * @param {string} userId
 * @param {string} key
 * @param {number} cooldownMs
 */
export async function underCooldown(userId, key, cooldownMs) {
  const row = await CompanyMemory.findOne({ user: userId, key }).lean();
  if (row?.value) {
    const t = Date.parse(row.value);
    if (Number.isFinite(t) && Date.now() - t < cooldownMs) {
      return { ok: false, detail: `Cooldown active for ${key}` };
    }
  }
  await CompanyMemory.findOneAndUpdate(
    { user: userId, key },
    {
      user: userId,
      key,
      value: new Date().toISOString(),
      category: "system",
      source: "runaway_guard",
    },
    { upsert: true }
  );
  return { ok: true };
}
