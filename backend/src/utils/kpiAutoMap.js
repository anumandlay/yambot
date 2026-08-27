/**
 * @fileoverview KPI auto-map — infer KPI bumps from task source/type on complete.
 * Purpose: Automatic measurement without explicit update_kpi in every run.
 * Downstream: worker complete handler.
 */

import { Goal } from "../models/Goal.js";
import { bumpGoalKpi } from "./kpiUpdater.js";

/** @type {Record<string, { kpi: string, delta: number, on: "success"|"failure"|"both" }[]>} */
const SOURCE_RULES = {
  campaign: [{ kpi: "emails_sent", delta: 1, on: "success" }],
  campaign_reply: [{ kpi: "replies_handled", delta: 1, on: "success" }],
  ticket: [{ kpi: "tickets_touched", delta: 1, on: "both" }],
  trigger: [{ kpi: "trigger_runs", delta: 1, on: "both" }],
};

/**
 * @param {import('mongoose').Document} task
 * @param {boolean} success
 */
export async function applyAutoKpiFromTask(task, success) {
  if (!task.goalRef) return [];

  const goal = await Goal.findById(task.goalRef);
  if (!goal) return [];

  const source = String(task.events?.[0]?.payload?.source || "").toLowerCase();
  const bumps = [];

  for (const [prefix, rules] of Object.entries(SOURCE_RULES)) {
    if (!source.includes(prefix)) continue;
    for (const rule of rules) {
      if (rule.on === "success" && !success) continue;
      if (rule.on === "failure" && success) continue;
      const hasKpi = (goal.kpis || []).some((k) => k.name === rule.kpi);
      if (!hasKpi && (goal.kpis || []).length > 5) continue;
      bumps.push(await bumpGoalKpi(goal, rule.kpi, rule.delta));
    }
  }

  if (task.ticketRef && success) {
    bumps.push(await bumpGoalKpi(goal, "tickets_resolved", 1));
  }

  return bumps;
}
