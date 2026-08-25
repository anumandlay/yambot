/**
 * @fileoverview Skill model — reusable workflows learned from demonstrations.
 * Purpose: Store production-ready skills generated from human demos or manual authoring.
 * Downstream: worker skill detection, Skills UI, training pipeline.
 */

import mongoose from "mongoose";

export const SKILL_STATUSES = ["draft", "training", "production", "deprecated"];
export const SKILL_EXECUTION_MODES = ["hints", "replay"];

const skillSchema = new mongoose.Schema(
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
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: SKILL_STATUSES,
      default: "draft",
      index: true,
    },
    triggers: { type: [String], default: [] },
    steps: { type: [mongoose.Schema.Types.Mixed], default: [] },
    verificationRules: { type: [String], default: [] },
    /**
     * hints = inject steps into LLM prompt only (default).
     * replay = run stored demo actions (click/type/navigate) before the agent loop.
     */
    executionMode: {
      type: String,
      enum: SKILL_EXECUTION_MODES,
      default: "hints",
    },
    /** When true, failed verificationRules mark the task as failed (not just a warning). */
    enforceVerification: { type: Boolean, default: false },
    sourceDemonstration: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Demonstration",
      default: null,
    },
    stats: {
      runs: { type: Number, default: 0 },
      successes: { type: Number, default: 0 },
      failures: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

export const Skill = mongoose.model("Skill", skillSchema);
