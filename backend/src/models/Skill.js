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
    /** URL-safe invoke token — `/slug` in chat (defaults from name). */
    slug: { type: String, trim: true, default: "", index: true },
    description: { type: String, default: "", trim: true },
    /**
     * Hermes-style SKILL.md playbook (When to use, Procedure, Pitfalls, Verification).
     * Injected into worker prompt when skill is matched or slash-invoked.
     */
    playbookMd: { type: String, default: "" },
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
    /** Task that produced an auto-suggested draft skill after a successful run. */
    sourceTask: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      default: null,
      index: true,
    },
    /**
     * Stable fingerprint for upserting learned skills (agent workflow), not one draft per task.
     * Format: `domain|sorted-significant-tokens`
     */
    workflowKey: { type: String, default: "", trim: true, index: true },
    /**
     * When set, this skill is superseded — worker catalog prefers the replacement.
     * Set when deprecating duplicates after learn/promote.
     */
    replacementSkill: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Skill",
      default: null,
    },
    stats: {
      runs: { type: Number, default: 0 },
      successes: { type: Number, default: 0 },
      failures: { type: Number, default: 0 },
      /** Progressive disclosure: auto/slash bind count. */
      selected: { type: Number, default: 0 },
      /** skill_view / explicit hydrate count. */
      loaded: { type: Number, default: 0 },
      /** Successful finishes while this skill was active. */
      helped: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

skillSchema.index({ user: 1, slug: 1 }, { unique: true, partialFilterExpression: { slug: { $type: "string", $ne: "" } } });
skillSchema.index(
  { user: 1, agent: 1, workflowKey: 1 },
  { partialFilterExpression: { workflowKey: { $type: "string", $ne: "" } } }
);

export const Skill = mongoose.model("Skill", skillSchema);
