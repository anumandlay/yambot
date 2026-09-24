/**
 * @fileoverview TaskPlan model — Hermes-depth multi-step run state.
 * Purpose: Persist goal, entities, dependency steps, working state, waiting_user pauses.
 * Downstream: taskPlanPlanner.js, taskPlanRunner.js, chat Auto, worker complete.
 */

import mongoose from "mongoose";

export const TASK_PLAN_STATUSES = [
  "planning",
  "running",
  "waiting_user",
  "done",
  "error",
  "cancelled",
];

export const TASK_PLAN_STEP_KINDS = [
  "computer",
  "composio",
  "send_email",
  "send_slack",
  "verify",
  "ask_user",
];

export const TASK_PLAN_STEP_STATUSES = [
  "pending",
  "ready",
  "running",
  "done",
  "error",
  "skipped",
];

const stepSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    kind: { type: String, enum: TASK_PLAN_STEP_KINDS, required: true },
    label: { type: String, default: "", trim: true },
    userText: { type: String, default: "", trim: true },
    dependsOn: { type: [String], default: [] },
    toolkit: { type: String, default: "", trim: true },
    specId: { type: String, default: "", trim: true },
    to: { type: String, default: "", trim: true },
    usePriorContent: { type: Boolean, default: false },
    status: {
      type: String,
      enum: TASK_PLAN_STEP_STATUSES,
      default: "pending",
    },
    result: { type: String, default: "" },
    error: { type: String, default: "" },
  },
  { _id: false }
);

const taskPlanSchema = new mongoose.Schema(
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
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      required: true,
      index: true,
    },
    goal: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: TASK_PLAN_STATUSES,
      default: "planning",
      index: true,
    },
    /** Extracted entities: website, data_to_extract, email_recipient, … */
    entities: { type: mongoose.Schema.Types.Mixed, default: {} },
    /** Slots still needed before continuing (e.g. email_recipient). */
    missingSlots: { type: [String], default: [] },
    /** Question shown when status=waiting_user. */
    clarifyQuestion: { type: String, default: "", trim: true },
    steps: { type: [stepSchema], default: [] },
    workingState: { type: mongoose.Schema.Types.Mixed, default: {} },
    activeTaskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      default: null,
    },
    lastError: { type: String, default: "" },
  },
  { timestamps: true }
);

taskPlanSchema.index({ chat: 1, agent: 1, status: 1, updatedAt: -1 });

export const TaskPlan = mongoose.model("TaskPlan", taskPlanSchema);
