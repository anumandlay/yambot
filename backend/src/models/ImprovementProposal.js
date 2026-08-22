/**
 * @fileoverview ImprovementProposal — autonomous improvement loop output.
 * Purpose: Capture analyze→propose→test suggestions from performance data.
 * Downstream: Governance UI, manager review.
 */

import mongoose from "mongoose";

export const IMPROVEMENT_STATUSES = ["proposed", "approved", "rejected", "deployed", "testing"];

const improvementProposalSchema = new mongoose.Schema(
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
      default: null,
      index: true,
    },
    goal: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Goal",
      default: null,
    },
    status: {
      type: String,
      enum: IMPROVEMENT_STATUSES,
      default: "proposed",
      index: true,
    },
    title: { type: String, required: true, trim: true },
    currentState: { type: String, default: "", trim: true },
    proposedState: { type: String, default: "", trim: true },
    expectedImpact: { type: String, default: "", trim: true },
    risk: { type: String, default: "medium", trim: true },
    evidence: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const ImprovementProposal = mongoose.model("ImprovementProposal", improvementProposalSchema);
