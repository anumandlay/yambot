/**
 * @fileoverview AgentMessage — durable agent-to-agent hop (v3 bus).
 * Purpose: Audit typed A→B messages (task/question/approval/handoff/event) + results.
 * Downstream: agentMessageBus; worker/API message_agent; Agent Threads UI; Operations.
 */

import mongoose from "mongoose";

export const AGENT_MESSAGE_TYPES = [
  "task",
  "question",
  "approval",
  "handoff",
  "event",
  "result",
];
export const AGENT_MESSAGE_STATUSES = [
  "queued",
  "running",
  "done",
  "error",
  "timeout",
];

const agentMessageSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    fromAgent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      required: true,
      index: true,
    },
    toAgent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: AGENT_MESSAGE_TYPES,
      required: true,
      index: true,
    },
    content: { type: String, default: "", trim: true, maxlength: 20_000 },
    status: {
      type: String,
      enum: AGENT_MESSAGE_STATUSES,
      default: "queued",
      index: true,
    },
    parentTask: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      default: null,
      index: true,
    },
    childTask: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      default: null,
      index: true,
    },
    /** Stable id linking hops in one Agent↔Agent thread. */
    conversationKey: { type: String, default: "", index: true },
    hopDepth: { type: Number, default: 1, min: 1, max: 8 },
    resultSummary: { type: String, default: "", maxlength: 8000 },
    /** Structured return for callers (success, childTaskId, hopDepth, …). */
    resultPayload: { type: mongoose.Schema.Types.Mixed, default: null },
    lastError: { type: String, default: "", maxlength: 2000 },
    wait: { type: Boolean, default: true },
  },
  { timestamps: true }
);

agentMessageSchema.index({ user: 1, parentTask: 1, createdAt: -1 });
agentMessageSchema.index({ user: 1, conversationKey: 1, createdAt: -1 });

export const AgentMessage = mongoose.model("AgentMessage", agentMessageSchema);
