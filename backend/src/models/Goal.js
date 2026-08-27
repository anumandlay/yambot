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
    /** Optional list folder — EntityGroup with type goal. */
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EntityGroup",
      default: null,
      index: true,
    },
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
    /** Goal-directed autonomy — periodic self-assessment and task spawning. */
    autonomy: {
      enabled: { type: Boolean, default: false },
      checkIntervalMinutes: { type: Number, default: 60, min: 15 },
      autoRun: { type: Boolean, default: true },
      lastCheckAt: { type: Date, default: null },
    },
    /** SLA for response/completion when this goal drives work. */
    sla: {
      responseMinutes: { type: Number, default: 0, min: 0 },
      name: { type: String, default: "", trim: true },
    },
    /**
     * Optional event bus type emitted when a linked task completes successfully
     * (e.g. crm.aanya.found). Triggers can listen for this instead of task.completed.
     */
    completionEventType: { type: String, default: "", trim: true },
    /** Optional event type when a linked task fails (e.g. crm.aanya.not_found). */
    completionEventOnFailure: { type: String, default: "", trim: true },
    /** When true, LLM reads task result and emits one of outcomeBranches after completion. */
    outcomeRoutingEnabled: { type: Boolean, default: false },
    /** LLM outcome branches: { label, eventType, description }[] */
    outcomeBranches: {
      type: [
        {
          label: { type: String, default: "", trim: true },
          eventType: { type: String, default: "", trim: true },
          description: { type: String, default: "", trim: true },
        },
      ],
      default: [],
    },
    /** When true, spawn parallel follow-up tasks/goals after each run completes. */
    completionActionsEnabled: { type: Boolean, default: false },
    /** rules = keyword/regex on when field; llm = LLM multi-picks from candidates. */
    completionActionsPickMode: { type: String, enum: ["rules", "llm"], default: "rules" },
    /** Parallel follow-ups: instruction text or delegate to another goal. */
    completionActions: {
      type: [
        {
          label: { type: String, default: "", trim: true },
          runOn: { type: String, enum: ["success", "failure", "both"], default: "success" },
          when: { type: String, default: "", trim: true },
          kind: { type: String, enum: ["instruction", "goal"], default: "instruction" },
          agentId: { type: String, default: "", trim: true },
          goalId: { type: String, default: "", trim: true },
          instructions: { type: String, default: "", trim: true },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

/**
 * Normalizes dot-separated event type strings for the company event bus.
 * @param {string} value
 * @returns {string}
 */
export function normalizeGoalEventType(value) {
  const t = String(value || "").trim();
  if (!t) return "";
  if (!/^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(t)) return "";
  return t.slice(0, 120);
}

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
    group: g.group || null,
    instructions: g.instructions || "",
    successCriteria: g.successCriteria || "",
    status: g.status || "active",
    priority: g.priority || "normal",
    kpis: Array.isArray(g.kpis) ? g.kpis : [],
    autonomy: g.autonomy || { enabled: false, checkIntervalMinutes: 60, autoRun: true },
    sla: g.sla || { responseMinutes: 0, name: "" },
    completionEventType: g.completionEventType || "",
    completionEventOnFailure: g.completionEventOnFailure || "",
    outcomeRoutingEnabled: Boolean(g.outcomeRoutingEnabled),
    outcomeBranches: Array.isArray(g.outcomeBranches) ? g.outcomeBranches : [],
    completionActionsEnabled: Boolean(g.completionActionsEnabled),
    completionActionsPickMode: g.completionActionsPickMode === "llm" ? "llm" : "rules",
    completionActions: Array.isArray(g.completionActions) ? g.completionActions : [],
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
