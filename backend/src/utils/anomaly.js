/**
 * @fileoverview Anomaly detection — baseline metrics and deviation alerts.
 * Purpose: Notice unusual situations (zero leads, spend spikes) for triggers and events.
 * Downstream: eventBus, triggerEngine, goal autonomy.
 */

import { MetricBaseline, updateBaselineSample } from "../models/MetricBaseline.js";
import { emitEvent } from "./eventBus.js";

/**
 * Records a metric sample and returns anomaly info if value is outside normal range.
 * @param {object} opts
 * @returns {Promise<{ anomaly: boolean, baseline: object, zScore?: number }>}
 */
export async function recordMetricSample(opts) {
  const userId = opts.userId;
  const metricKey = String(opts.metricKey || "").trim();
  const value = Number(opts.value);
  if (!userId || !metricKey || !Number.isFinite(value)) {
    return { anomaly: false, baseline: null };
  }

  let baseline = await MetricBaseline.findOne({
    user: userId,
    metricKey,
    agent: opts.agentId || null,
  });
  if (!baseline) {
    baseline = await MetricBaseline.create({
      user: userId,
      metricKey,
      agent: opts.agentId || null,
      goal: opts.goalId || null,
    });
  }

  const prevMean = baseline.mean || 0;
  const prevCount = baseline.sampleCount || 0;
  let anomaly = false;
  let zScore = 0;

  if (prevCount >= 5) {
    const spread = Math.max(1, Math.abs(baseline.max - baseline.min) / 2);
    zScore = Math.abs(value - prevMean) / spread;
    anomaly = zScore >= 2.5;
  }

  updateBaselineSample(baseline, value);
  await baseline.save();

  if (anomaly) {
    await emitEvent({
      userId,
      type: "anomaly.detected",
      source: "anomaly",
      significance: zScore >= 4 ? "critical" : "high",
      agentId: opts.agentId,
      goalId: opts.goalId,
      summary: `Anomaly on ${metricKey}: ${value} (baseline ~${prevMean.toFixed(2)})`,
      payload: { metricKey, value, mean: prevMean, zScore },
    });
  }

  return { anomaly, baseline, zScore };
}
