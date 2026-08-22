/**
 * @fileoverview Task model — unit of work claimed by a browser worker.
 * Purpose: Queue browser goals from the website and store live execution state/results.
 * Downstream: chats routes (create), extension routes (claim/events/complete),
 * Playwright cloud workers, frontend polling.
 */

import mongoose from "mongoose";

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
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      default: null,
      index: true,
    },
    /** Frozen copy of agent config at enqueue time (stable for the worker run). */
    agentSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    /**
     * Copied from agent.runner at enqueue so claim filters stay stable if the agent is edited mid-queue.
     * @type {"any"|"extension"|"cloud"}
     */
    runner: {
      type: String,
      enum: ["any", "extension", "cloud"],
      default: "any",
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "running", "waiting_user", "done", "error", "cancelled"],
      default: "pending",
      index: true,
    },
    events: { type: [eventSchema], default: [] },
    /** Compact observe→action→verify chain recorded at task complete (Phase 5). */
    trajectory: { type: [mongoose.Schema.Types.Mixed], default: [] },
    resultSummary: { type: String, default: "" },
    lastError: { type: String, default: "" },
    claimedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const Task = mongoose.model("Task", taskSchema);
