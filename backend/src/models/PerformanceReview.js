/**
 * @fileoverview PerformanceReview — periodic employee performance summaries.
 * Purpose: Auto-generated reviews from task stats, costs, escalations, evaluation scores.
 * Downstream: Governance performance tab.
 */

import mongoose from "mongoose";

const performanceReviewSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      required: true,
      index: true,
    },
    periodDays: { type: Number, default: 30 },
    summary: { type: String, default: "", trim: true },
    metrics: {
      tasksCompleted: { type: Number, default: 0 },
      successRate: { type: Number, default: 0 },
      avgEvaluationScore: { type: Number, default: 0 },
      totalTokens: { type: Number, default: 0 },
      estimatedUsd: { type: Number, default: 0 },
      escalationRate: { type: Number, default: 0 },
      avgDurationSec: { type: Number, default: 0 },
    },
    strengths: { type: [String], default: [] },
    weaknesses: { type: [String], default: [] },
    recommendations: { type: [String], default: [] },
  },
  { timestamps: true }
);

performanceReviewSchema.index({ user: 1, agent: 1, createdAt: -1 });

export const PerformanceReview = mongoose.model("PerformanceReview", performanceReviewSchema);
