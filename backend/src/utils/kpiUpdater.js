/**
 * @fileoverview KPI updater — bump goal KPIs from task results or agent actions.
 * Purpose: Close the autonomy loop — measure progress after runs complete.
 * Downstream: worker complete handler, update_kpi worker action.
 */

import { Goal } from "../models/Goal.js";
import { emitEvent } from "./eventBus.js";
import { syncGoalKpiToBaseline, recordMetricSample } from "./metricWriter.js";

/**
 * @param {import('mongoose').Document} goalDoc
 * @param {string} kpiName
 * @param {number} delta
 * @param {{ setAbsolute?: number }} [opts]
 */
export async function bumpGoalKpi(goalDoc, kpiName, delta, opts = {}) {
  const name = String(kpiName || "").trim();
  if (!name) return { ok: false, detail: "kpi name required" };

  goalDoc.kpis = goalDoc.kpis || [];
  let kpi = goalDoc.kpis.find((k) => k.name === name);
  if (!kpi) {
    kpi = { name, current: 0, target: null, unit: "" };
    goalDoc.kpis.push(kpi);
  }

  if (opts.setAbsolute != null && Number.isFinite(Number(opts.setAbsolute))) {
    kpi.current = Number(opts.setAbsolute);
  } else {
    kpi.current = (Number(kpi.current) || 0) + (Number(delta) || 0);
  }
  goalDoc.markModified("kpis");
  await goalDoc.save();

  await syncGoalKpiToBaseline(String(goalDoc.user), String(goalDoc._id), name, kpi.current);
  await recordMetricSample(String(goalDoc.user), `kpi.${name}`, kpi.current, {
    goalId: String(goalDoc._id),
  });

  await emitEvent({
    userId: goalDoc.user,
    type: "goal.kpi.updated",
    source: "kpi_updater",
    goalId: goalDoc._id,
    summary: `KPI ${name}: ${kpi.current}${kpi.target != null ? ` / ${kpi.target}` : ""}`,
    payload: { kpiName: name, current: kpi.current, target: kpi.target },
  });

  return { ok: true, kpi };
}

/**
 * Parses result text for KPI bumps like "KPI: leads_contacted +1" or JSON block.
 * @param {import('mongoose').Document} goalDoc
 * @param {string} summary
 */
export async function applyKpiFromTaskSummary(goalDoc, summary) {
  const text = String(summary || "");
  const bumps = [];

  const regex = /KPI:\s*([a-zA-Z0-9_.-]+)\s*([+-]=?)\s*(\d+(?:\.\d+)?)/gi;
  let m;
  while ((m = regex.exec(text))) {
    const name = m[1];
    const op = m[2];
    const val = Number(m[3]) || 0;
    const delta = op.startsWith("-") ? -val : val;
    bumps.push(await bumpGoalKpi(goalDoc, name, delta));
  }

  return bumps;
}

/**
 * @param {string} userId
 * @param {string} goalId
 * @param {string} kpiName
 * @param {number} delta
 * @param {object} [opts]
 */
export async function updateGoalKpiById(userId, goalId, kpiName, delta, opts = {}) {
  const goal = await Goal.findOne({ _id: goalId, user: userId });
  if (!goal) return { ok: false, detail: "Goal missing" };
  return bumpGoalKpi(goal, kpiName, delta, opts);
}
