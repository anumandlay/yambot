/**
 * @fileoverview Task model — unit of work claimed by a browser worker.
 * Purpose: Queue browser goals from the website and store live execution state/results.
 * Downstream: chats routes (create), worker routes (claim/events/complete),
 * Playwright cloud workers, frontend polling.
 */

import mongoose from "mongoose";

/** Task priority for queue ordering (Layer 2 escalation seed). */
export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"];

/**
 * @param {string} priority
 * @returns {number}
 */
export function priorityRank(priority) {
  switch (String(priority || "normal")) {
    case "urgent":
      return 4;
    case "high":
      return 3;
    case "low":
      return 1;
    default:
      return 2;
  }
}

const llmUsageSchema = new mongoose.Schema(
  {
    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    calls: { type: Number, default: 0 },
    /** Rough USD estimate from token counts (governance Layer 5). */
    estimatedUsd: { type: Number, default: 0 },
  },
  { _id: false }
);

const eventSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const taskSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    chat: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
      index: true,
    },
    message: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      required: true,
    },
    goal: { type: String, required: true },
    /** Link to durable Goal document when enqueued from Goals (Layer 1). */
    goalRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Goal",
      default: null,
      index: true,
    },
    /** Link to Trigger when enqueued from triggerEngine (for completion events). */
    triggerRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Trigger",
      default: null,
      index: true,
    },
    priority: {
      type: String,
      enum: TASK_PRIORITIES,
      default: "normal",
      index: true,
    },
    priorityRank: { type: Number, default: 2, index: true },
    llmUsage: { type: llmUsageSchema, default: () => ({}) },
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      default: null,
      index: true,
    },
    /** Frozen copy of agent config at enqueue time (stable for the worker run). */
    agentSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Explicit slash-invoked production skill for this run (`/skill-slug` in chat). */
    invokedSkill: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Skill",
      default: null,
      index: true,
    },
    /**
     * Copied from agent at enqueue (always cloud).
     * @type {"cloud"}
     */
    runner: {
      type: String,
      enum: ["cloud", "any", "extension"],
      default: "cloud",
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "blocked", "running", "waiting_user", "done", "error", "cancelled"],
      default: "pending",
      index: true,
    },
    /** Tasks that must complete before this one can run. */
    dependsOn: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Task" }],
      default: [],
    },
    slaDeadline: { type: Date, default: null, index: true },
    slaName: { type: String, default: "", trim: true },
    maxDurationMinutes: { type: Number, default: 0, min: 0 },
    estimatedValueUsd: { type: Number, default: 0, min: 0 },
    startedAt: { type: Date, default: null },
    events: { type: [eventSchema], default: [] },
    /** Compact observe→action→verify chain recorded at task complete (Phase 5). */
    trajectory: { type: [mongoose.Schema.Types.Mixed], default: [] },
    resultSummary: { type: String, default: "" },
    lastError: { type: String, default: "" },
    claimedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    escalationLevel: { type: Number, default: 0 },
    evaluation: {
      score: { type: Number, default: null },
      summary: { type: String, default: "" },
      at: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

export const Task = mongoose.model("Task", taskSchema);
