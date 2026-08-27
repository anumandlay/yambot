/**
 * @fileoverview Metric writer — sync KPI bumps and samples to MetricBaseline.
 * Purpose: Feed condition/anomaly triggers with live metric values.
 * Downstream: kpiUpdater, goalAutonomy, triggerEvaluators.
 */

import { MetricBaseline, updateBaselineSample } from "../models/MetricBaseline.js";

/**
 * Records a metric sample for trigger condition evaluation.
 * @param {string} userId
 * @param {string} metricKey
 * @param {number} value
 * @param {{ agentId?: string, goalId?: string }} [opts]
 */
export async function recordMetricSample(userId, metricKey, value, opts = {}) {
  const key = String(metricKey || "").trim();
  if (!key || !Number.isFinite(Number(value))) return null;

  let baseline = await MetricBaseline.findOne({
    user: userId,
    metricKey: key,
    agent: opts.agentId || null,
  });
  if (!baseline) {
    baseline = await MetricBaseline.create({
      user: userId,
      metricKey: key,
      agent: opts.agentId || null,
      goal: opts.goalId || null,
    });
  }
  updateBaselineSample(baseline, Number(value));
  await baseline.save();
  return baseline;
}

/**
 * @param {string} userId
 * @param {string} goalId
 * @param {string} kpiName
 * @param {number} current
 */
export async function syncGoalKpiToBaseline(userId, goalId, kpiName, current) {
  const metricKey = `goal.${goalId}.kpi.${kpiName}`;
  return recordMetricSample(userId, metricKey, current, { goalId });
}
