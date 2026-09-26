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
    /** Primary Entity (lead/customer) this run operates on. */
    entityRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entity",
      default: null,
      index: true,
    },
    /** Campaign enrollment when spawned from campaignEngine. */
    enrollmentRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Enrollment",
      default: null,
      index: true,
    },
    campaignRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      default: null,
      index: true,
    },
    /** Support ticket this run triages or resolves. */
    ticketRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      default: null,
      index: true,
    },
    /** WorkflowRun waiting on this agent step (Executable Business Runtime). */
    workflowRunId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WorkflowRun",
      default: null,
      index: true,
    },
    /** Shared business correlation across events / handoffs / workflows. */
    correlationId: { type: String, default: "", index: true },
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
    /**
     * How the cloud worker should drive the live browser for this run.
     * auto = Playwright locators first; activate CUA after 2 failed recoverable attempts.
     * cua = start in screenshot/coordinate computer-use (chat said “using cua”).
     * jev = Jev Ultrafast (TypeSafe op+element on the same Chrome; chat said “using jev”).
     * playwright = never auto-escalate to CUA.
     * Why: website agents stay on the same Xvfb Chrome box — no XFCE swap.
     */
    computerUseMode: {
      type: String,
      enum: ["auto", "cua", "playwright", "jev"],
      default: "auto",
    },
    status: {
      type: String,
      enum: [
        "pending",
        "blocked",
        "running",
        "waiting_user",
        /** Browser idle — parked while peers run; does not block claiming the next goal. */
        "waiting_peer",
        "done",
        "error",
        "cancelled",
      ],
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
    /**
     * Async A2A: peer hops A fired with wait:false; B’s finish fills resultSummary.
     * Worker/API drain unconsumed done/error rows into the parent LLM notes each turn.
     */
    pendingPeerResults: {
      type: [
        new mongoose.Schema(
          {
            agentMessageId: { type: String, required: true },
            toAgentId: { type: String, default: "" },
            toAgentName: { type: String, default: "" },
            mode: { type: String, default: "task" },
            contentPreview: { type: String, default: "" },
            status: {
              type: String,
              enum: ["waiting", "done", "error"],
              default: "waiting",
            },
            resultSummary: { type: String, default: "" },
            consumed: { type: Boolean, default: false },
            /** async = fire-and-forget; soft = work until softWaitUntil then pause for peer. */
            waitMode: {
              type: String,
              enum: ["async", "soft"],
              default: "async",
            },
            softWaitUntil: { type: Date, default: null },
            createdAt: { type: Date, default: Date.now },
            completedAt: { type: Date, default: null },
            consumedAt: { type: Date, default: null },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    /**
     * Mid-run chat (v2): operator messages injected while the task is running.
     * Worker drains unconsumed rows into OPERATOR MESSAGE notes each LLM turn.
     */
    pendingOperatorMessages: {
      type: [
        new mongoose.Schema(
          {
            messageId: { type: String, default: "" },
            content: { type: String, required: true, maxlength: 8000 },
            consumed: { type: Boolean, default: false },
            createdAt: { type: Date, default: Date.now },
            consumedAt: { type: Date, default: null },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    /** Compact observe→action→verify chain recorded at task complete (Phase 5). */
    trajectory: { type: [mongoose.Schema.Types.Mixed], default: [] },
    resultSummary: { type: String, default: "" },
    lastError: { type: String, default: "" },
    /**
     * Cross-mode combo: after this computer Task completes, run Composio steps
     * (Notion / Slack / Gmail) with the result summary as prior content.
     */
    comboFollowup: { type: mongoose.Schema.Types.Mixed, default: null },
    /**
     * Ephemeral run state (not durable MEMORY).
     * Phase 2: memoryExtractAt / memoryExtractKey for idempotent post-run extract;
     * may also hold short-lived task scratch (current URL hints, etc.).
     */
    workingState: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Hermes-depth TaskPlan this computer step belongs to. */
    taskPlanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TaskPlan",
      default: null,
      index: true,
    },
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
