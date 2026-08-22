/**
 * @fileoverview Goal model — durable objectives for agents (Employee OS / Layer 1).
 * Purpose: Track what an agent should achieve beyond one-off chat messages — success criteria, KPIs, priority, hierarchy.
 * Downstream: `/api/goals` CRUD + run; Task.goalRef links executions; governance audit on lifecycle events.
 */

import mongoose from "mongoose";

export const GOAL_STATUSES = ["active", "paused", "completed", "archived"];
export const GOAL_PRIORITIES = ["low", "normal", "high", "urgent"];

const kpiSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    target: { type: Number, default: null },
    current: { type: Number, default: 0 },
    unit: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const goalSchema = new mongoose.Schema(
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
    /** Optional parent for delegation / workforce hierarchy (Layer 3 seed). */
    parentGoal: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Goal",
      default: null,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    /** Text sent to the worker when this goal is run. */
    instructions: { type: String, default: "", trim: true },
    successCriteria: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: GOAL_STATUSES,
      default: "active",
      index: true,
    },
    priority: {
      type: String,
      enum: GOAL_PRIORITIES,
      default: "normal",
      index: true,
    },
    kpis: { type: [kpiSchema], default: [] },
    stats: {
      runs: { type: Number, default: 0 },
      successes: { type: Number, default: 0 },
      failures: { type: Number, default: 0 },
      lastRunAt: { type: Date, default: null },
    },
    /** Dedicated chat thread for runs of this goal. */
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      default: null,
    },
  },
  { timestamps: true }
);

/**
 * @param {import('mongoose').Document|object} doc
 * @returns {object}
 */
export function toGoalPublic(doc) {
  const g = doc.toObject ? doc.toObject() : doc;
  return {
    _id: g._id,
    agent: g.agent,
    parentGoal: g.parentGoal,
    title: g.title,
    description: g.description || "",
    instructions: g.instructions || "",
    successCriteria: g.successCriteria || "",
    status: g.status || "active",
    priority: g.priority || "normal",
    kpis: Array.isArray(g.kpis) ? g.kpis : [],
    stats: g.stats || { runs: 0, successes: 0, failures: 0, lastRunAt: null },
    chatId: g.chatId,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
  };
}

/**
 * Builds the worker goal string from a goal document.
 * @param {object} goal
 * @returns {string}
 */
export function buildGoalRunText(goal) {
  const parts = [
    goal.title ? `TITLE: ${goal.title}` : "",
    goal.description ? `DESCRIPTION:\n${goal.description}` : "",
    goal.instructions ? `INSTRUCTIONS:\n${goal.instructions}` : "",
    goal.successCriteria ? `SUCCESS CRITERIA:\n${goal.successCriteria}` : "",
  ].filter(Boolean);
  return parts.join("\n\n").trim() || goal.title || "Complete the goal.";
}

/**
 * Updates run statistics after a task completes.
 * @param {import('mongoose').Document} goalDoc
 * @param {boolean} success
 */
export async function recordGoalRun(goalDoc, success) {
  goalDoc.stats = goalDoc.stats || { runs: 0, successes: 0, failures: 0 };
  goalDoc.stats.runs = (goalDoc.stats.runs || 0) + 1;
  if (success) goalDoc.stats.successes = (goalDoc.stats.successes || 0) + 1;
  else goalDoc.stats.failures = (goalDoc.stats.failures || 0) + 1;
  goalDoc.stats.lastRunAt = new Date();
  await goalDoc.save();
}

export const Goal = mongoose.model("Goal", goalSchema);
