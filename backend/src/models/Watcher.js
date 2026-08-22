/**
 * @fileoverview Watcher model — continuous perception monitors for agents.
 * Purpose: Poll URLs/metrics and emit change events when state diverges.
 * Downstream: watcherEngine.js, event bus.
 */

import mongoose from "mongoose";

export const WATCHER_TARGETS = ["url", "http", "text_contains"];

const watcherSchema = new mongoose.Schema(
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
    name: { type: String, required: true, trim: true },
    enabled: { type: Boolean, default: true, index: true },
    targetType: {
      type: String,
      enum: WATCHER_TARGETS,
      default: "url",
    },
    target: { type: String, required: true, trim: true },
    intervalMinutes: { type: Number, default: 30, min: 5, max: 1440 },
    significance: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    lastSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    lastCheckedAt: { type: Date, default: null },
    lastChangeAt: { type: Date, default: null },
    changeCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Watcher = mongoose.model("Watcher", watcherSchema);
