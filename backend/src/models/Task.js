/**
 * @fileoverview Task model — unit of work claimed by the Chrome extension worker.
 * Purpose: Queue browser goals from the website and store live execution state/results.
 * Downstream: chats routes (create), extension routes (claim/events/complete), frontend polling.
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
    status: {
      type: String,
      enum: ["pending", "running", "waiting_user", "done", "error", "cancelled"],
      default: "pending",
      index: true,
    },
    events: { type: [eventSchema], default: [] },
    resultSummary: { type: String, default: "" },
    lastError: { type: String, default: "" },
    claimedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const Task = mongoose.model("Task", taskSchema);
