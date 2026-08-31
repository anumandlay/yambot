/**
 * @fileoverview CEO causal memory — remember strategies that failed/succeeded.
 * Purpose: “We tried this 3 months ago; don’t repeat” grounded in DecisionJournal + KPIs.
 * Downstream: ceoAutonomy, /api/ceo/causal-memory, chatCeo context.
 */

import { DecisionJournal } from "../models/DecisionJournal.js";
import { CompanyMemory } from "../models/CompanyMemory.js";
import { attributeOutcomes } from "./attribution.js";

/**
 * Record a strategy outcome into CompanyMemory for future CEO loops.
 * @param {string} userId
 * @param {{ strategy: string, outcome: "success"|"failure"|"neutral", reason?: string, evidence?: object }} body
 */
export async function recordCausalLesson(userId, body) {
  const strategy = String(body.strategy || "").trim().slice(0, 200);
  if (!strategy) return { ok: false, detail: "strategy required" };
  const outcome = ["success", "failure", "neutral"].includes(body.outcome)
    ? body.outcome
    : "neutral";
  const key = `causal:${strategy
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .slice(0, 80)}`;
  const value = JSON.stringify({
    strategy,
    outcome,
    reason: String(body.reason || "").slice(0, 1000),
    evidence: body.evidence || {},
    at: new Date().toISOString(),
  }).slice(0, 4000);

  await CompanyMemory.findOneAndUpdate(
    { user: userId, key },
    {
      user: userId,
      key,
      value,
      category: "causal",
      source: "ceo_causal",
      confidence: outcome === "failure" ? 0.9 : 0.7,
    },
    { upsert: true }
  );

  await DecisionJournal.create({
    user: userId,
    actorType: "system",
    authorityLevel: "observe",
    decision: `Causal lesson (${outcome}): ${strategy}`,
    rationale: body.reason || "",
    context: { causalKey: key, evidence: body.evidence || {} },
    outcome,
    approved: true,
  }).catch(() => {});

  return { ok: true, key };
}

/**
 * Load lessons that should block or prefer strategies.
 * @param {string} userId
 * @param {{ limit?: number }} [opts]
 */
export async function loadCausalLessons(userId, opts = {}) {
  const limit = Math.min(50, Number(opts.limit) || 20);
  const rows = await CompanyMemory.find({
    user: userId,
    key: { $regex: /^causal:/ },
  })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  const lessons = rows.map((r) => {
    try {
      return JSON.parse(String(r.value));
    } catch {
      return { strategy: r.key, outcome: "neutral", reason: String(r.value).slice(0, 200) };
    }
  });

  const failures = lessons.filter((l) => l.outcome === "failure");
  const successes = lessons.filter((l) => l.outcome === "success");

  return {
    ok: true,
    lessons,
    blocklist: failures.map((f) => f.strategy),
    prefer: successes.map((s) => s.strategy),
    promptBlock: failures.length
      ? `Do NOT repeat these failed strategies:\n${failures
          .map((f) => `- ${f.strategy}: ${f.reason || "failed previously"}`)
          .join("\n")}`
      : "",
  };
}

/**
 * Auto-harvest lessons from attribution + recent decisions.
 * @param {string} userId
 */
export async function harvestCausalLessons(userId) {
  const attr = await attributeOutcomes(userId, { sinceDays: 30 });
  let recorded = 0;
  for (const a of attr.attributions || []) {
    for (const kpi of a.kpis || []) {
      if (kpi.gapPct == null) continue;
      if (kpi.gapPct <= -20 && a.contributors?.[0]) {
        await recordCausalLesson(userId, {
          strategy: `Push ${a.contributors[0].name} harder on ${a.title}`,
          outcome: "failure",
          reason: `KPI ${kpi.name} still ${kpi.gapPct}% below target after ${a.contributors[0].runs} runs`,
          evidence: { goalId: a.goalId, kpi },
        });
        recorded += 1;
      }
      if (kpi.gapPct >= 0 && a.contributors?.[0]) {
        await recordCausalLesson(userId, {
          strategy: `Keep ${a.contributors[0].name} on ${a.title}`,
          outcome: "success",
          reason: `KPI ${kpi.name} at/above target; top contributor ${a.contributors[0].name}`,
          evidence: { goalId: a.goalId, kpi },
        });
        recorded += 1;
      }
    }
  }
  return { ok: true, recorded };
}
