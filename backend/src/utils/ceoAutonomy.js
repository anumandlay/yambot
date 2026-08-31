/**
 * @fileoverview Autonomous CEO decide→execute loop.
 * Purpose: Observe pulse → select strategy under operatingMode/authority → execute → journal → learn.
 * Downstream: scheduler tickCeoAutonomy, Command Center /ceo/loop.
 */

import { User } from "../models/User.js";
import { CompanyMemory } from "../models/CompanyMemory.js";
import { recordDecision } from "../models/DecisionJournal.js";
import { buildBusinessPulse, applyPulseAction, pickWorkforceAssignee } from "./businessPulse.js";
import { applyHeal } from "./healController.js";
import { emitEvent } from "./eventBus.js";
import { enqueueTask } from "./enqueueTask.js";

const MODE_RANK = {
  observe: 0,
  recommend: 1,
  assisted: 2,
  autonomous: 3,
  autopilot: 4,
};

/**
 * @param {string} mode
 * @returns {number}
 */
function modeRank(mode) {
  return MODE_RANK[String(mode || "assisted")] ?? 2;
}

/**
 * Turn pulse findings into executable strategies.
 * @param {object} pulse
 * @returns {{ id: string, findingKind: string, authority: string, risk: string, title: string, action: object }[]}
 */
function strategiesFromPulse(pulse) {
  /** @type {{ id: string, findingKind: string, authority: string, risk: string, title: string, action: object }[]} */
  const out = [];
  for (const f of pulse.findings || []) {
    if (f.kind === "repeated_failures" && f.agentId) {
      out.push({
        id: `heal_${f.agentId}`,
        findingKind: f.kind,
        authority: "internal",
        risk: "low",
        title: `Self-heal agent after repeated failures`,
        action: {
          type: "heal",
          agentId: f.agentId,
          errorHint: f.detail,
        },
      });
      out.push({
        id: `recover_${f.agentId}`,
        findingKind: f.kind,
        authority: "internal",
        risk: "low",
        title: `Apply recovery playbook`,
        action: {
          type: "apply_recovery",
          authority: "internal",
          agentId: f.agentId,
          errorHint: f.detail,
        },
      });
    }
    if (f.kind === "kpi_gap" || f.kind === "goal_kpi_gap") {
      out.push({
        id: `kpi_${f.goalId || f.id || out.length}`,
        findingKind: f.kind,
        authority: "internal",
        risk: "medium",
        title: `Assign work for KPI gap`,
        action: {
          type: "assign_kpi_work",
          goalId: f.goalId,
          detail: f.detail || f.title,
          agentId: f.agentId,
        },
      });
    }
    if (f.kind === "model_cost" || f.kind === "cost_opportunity") {
      if (f.agentId && f.profileId) {
        out.push({
          id: `model_${f.agentId}`,
          findingKind: f.kind,
          authority: "internal",
          risk: "low",
          title: `Route agent to cheaper LLM profile`,
          action: {
            type: "apply_model_route",
            authority: "internal",
            agentId: f.agentId,
            profileId: f.profileId,
            reason: f.detail || "CEO cost optimizer",
          },
        });
      }
    }
    if (f.kind === "draft_skill" && f.skillId) {
      out.push({
        id: `skill_${f.skillId}`,
        findingKind: f.kind,
        authority: "observe",
        risk: "low",
        title: `Review draft skill for promotion`,
        action: { type: "recommend_only", detail: f.title || f.detail },
      });
    }
  }
  return out;
}

/**
 * Whether current operating mode may auto-execute this strategy.
 * @param {string} mode
 * @param {{ risk: string, authority: string }} strategy
 */
function mayExecute(mode, strategy) {
  const r = modeRank(mode);
  if (r <= 1) return false; // observe / recommend
  if (r === 2) return false; // assisted — human confirms in UI
  if (r === 3) {
    // autonomous — internal + low/medium risk only
    return strategy.authority === "internal" && strategy.risk !== "high";
  }
  // autopilot — internal always; external only low risk
  if (strategy.authority === "external") return strategy.risk === "low";
  return true;
}

/**
 * Execute one strategy (or record recommendation).
 * @param {string} userId
 * @param {object} strategy
 * @param {{ execute: boolean, mode: string }} opts
 */
async function applyStrategy(userId, strategy, opts) {
  if (!opts.execute || strategy.action?.type === "recommend_only") {
    await recordDecision(userId, {
      actorType: "ceo",
      authorityLevel: strategy.authority || "observe",
      decision: `[${opts.mode}] Recommend: ${strategy.title}`,
      rationale: strategy.action?.detail || strategy.findingKind,
      context: { strategyId: strategy.id, action: strategy.action },
      outcome: "recommended",
      approved: false,
    }).catch(() => {});
    return { ok: true, executed: false, recommended: true, strategy };
  }

  const action = strategy.action || {};
  if (action.type === "heal") {
    const res = await applyHeal(userId, {
      agentId: action.agentId,
      errorHint: action.errorHint,
      auto: true,
    });
    await recordDecision(userId, {
      actorType: "ceo",
      authorityLevel: "internal",
      decision: `CEO loop heal: ${strategy.title}`,
      rationale: action.errorHint || "",
      context: { strategyId: strategy.id, heal: res },
      outcome: res.ok ? "applied" : "failed",
      approved: true,
    }).catch(() => {});
    return { ...res, executed: true, strategy };
  }

  if (action.type === "assign_kpi_work") {
    let agentId = action.agentId;
    if (!agentId) {
      const pick = await pickWorkforceAssignee(userId, { minReadiness: 40 });
      agentId = pick?.agent?._id ? String(pick.agent._id) : null;
    }
    if (!agentId) {
      return { ok: false, detail: "No assignee for KPI work", executed: false, strategy };
    }
    const enq = await enqueueTask({
      userId,
      agentId,
      goalText: `Address KPI gap: ${action.detail || "Improve goal KPI"}. Investigate and take corrective action.`,
      source: "ceo_loop",
      priority: "high",
      chatTitle: "CEO · KPI gap",
      goalRef: action.goalId || null,
      meta: { ceoStrategyId: strategy.id },
    });
    await recordDecision(userId, {
      actorType: "ceo",
      authorityLevel: "internal",
      decision: `CEO loop assigned KPI work to agent ${agentId}`,
      rationale: action.detail || "",
      context: { strategyId: strategy.id, taskId: String(enq.task._id) },
      outcome: "assigned",
      approved: true,
    }).catch(() => {});
    return { ok: true, executed: true, taskId: String(enq.task._id), strategy };
  }

  const pulseType = action.type;
  if (["apply_recovery", "apply_model_route", "hire_roles"].includes(pulseType)) {
    const res = await applyPulseAction(userId, action);
    await recordDecision(userId, {
      actorType: "ceo",
      authorityLevel: action.authority || strategy.authority,
      decision: `CEO loop: ${strategy.title}`,
      rationale: action.reason || action.errorHint || "",
      context: { strategyId: strategy.id, result: res },
      outcome: res.ok ? "applied" : "failed",
      approved: true,
    }).catch(() => {});
    return { ...res, executed: true, strategy };
  }

  return { ok: false, detail: `Unknown strategy action ${action.type}`, executed: false, strategy };
}

/**
 * One decide→execute cycle for a user.
 * @param {string} userId
 * @param {{ forceExecute?: boolean }} [opts]
 */
export async function runCeoLoop(userId, opts = {}) {
  const user = await User.findById(userId).select("settings").lean();
  const mode = user?.settings?.operatingMode || "assisted";
  const pulse = await buildBusinessPulse(userId);
  const strategies = strategiesFromPulse(pulse);

  /** @type {object[]} */
  const results = [];
  let executed = 0;
  let recommended = 0;

  for (const strategy of strategies.slice(0, 5)) {
    const execute = opts.forceExecute === true || mayExecute(mode, strategy);
    const res = await applyStrategy(userId, strategy, { execute, mode });
    results.push(res);
    if (res.executed && res.ok) executed += 1;
    if (res.recommended) recommended += 1;
  }

  await CompanyMemory.findOneAndUpdate(
    { user: userId, key: "ceo_loop_last" },
    {
      user: userId,
      key: "ceo_loop_last",
      value: new Date().toISOString(),
      meta: {
        mode,
        findings: (pulse.findings || []).length,
        strategies: strategies.length,
        executed,
        recommended,
      },
    },
    { upsert: true }
  ).catch(() => {});

  if (executed || recommended) {
    await emitEvent({
      userId,
      type: "ceo.loop.tick",
      source: "system",
      summary: `CEO loop (${mode}): ${executed} executed, ${recommended} recommended`,
      payload: { mode, executed, recommended, strategyCount: strategies.length },
      significance: executed ? "medium" : "low",
    }).catch(() => {});
  }

  return {
    ok: true,
    mode,
    pulse: { findings: pulse.findings || [], summary: pulse.summary },
    strategies,
    results,
    executed,
    recommended,
  };
}

/**
 * Scheduler: run CEO loop for users in autonomous/autopilot (and recommend-only for recommend mode).
 * @returns {Promise<{ users: number, executed: number, recommended: number }>}
 */
export async function tickCeoAutonomy() {
  const users = await User.find({
    "settings.operatingMode": { $in: ["recommend", "autonomous", "autopilot"] },
  })
    .select("_id settings")
    .limit(80)
    .lean();

  let executed = 0;
  let recommended = 0;
  for (const u of users) {
    const userId = String(u._id);
    const last = await CompanyMemory.findOne({ user: userId, key: "ceo_loop_last" }).lean();
    if (last?.value) {
      const t = Date.parse(last.value);
      // Why: avoid thrashing — one full loop every 20 minutes per account.
      if (Number.isFinite(t) && Date.now() - t < 20 * 60_000) continue;
    }
    try {
      const res = await runCeoLoop(userId);
      executed += res.executed || 0;
      recommended += res.recommended || 0;
    } catch (err) {
      console.error(`[ceoAutonomy] user ${userId}:`, err?.message || err);
    }
  }
  return { users: users.length, executed, recommended };
}
