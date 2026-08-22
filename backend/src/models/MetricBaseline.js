/**
 * @fileoverview MetricBaseline — rolling baselines for anomaly detection.
 * Purpose: Track normal ranges per metric key; flag unusual values.
 * Downstream: anomaly.js, triggerEngine anomaly triggers.
 */

import mongoose from "mongoose";

const metricBaselineSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    metricKey: { type: String, required: true, trim: true, index: true },
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      default: null,
      index: true,
    },
    goal: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Goal",
      default: null,
    },
    sampleCount: { type: Number, default: 0 },
    mean: { type: Number, default: 0 },
    min: { type: Number, default: 0 },
    max: { type: Number, default: 0 },
    lastValue: { type: Number, default: 0 },
    lastAt: { type: Date, default: null },
  },
  { timestamps: true }
);

metricBaselineSchema.index({ user: 1, metricKey: 1, agent: 1 }, { unique: true });

/**
 * Updates baseline with a new sample (running mean/min/max).
 * @param {object} baseline
 * @param {number} value
 */
export function updateBaselineSample(baseline, value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return;
  const n = (baseline.sampleCount || 0) + 1;
  const prevMean = baseline.mean || 0;
  baseline.mean = prevMean + (v - prevMean) / n;
  baseline.min = baseline.sampleCount ? Math.min(baseline.min, v) : v;
  baseline.max = baseline.sampleCount ? Math.max(baseline.max, v) : v;
  baseline.sampleCount = n;
  baseline.lastValue = v;
  baseline.lastAt = new Date();
}

export const MetricBaseline = mongoose.model("MetricBaseline", metricBaselineSchema);
