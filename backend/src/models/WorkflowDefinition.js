/**
 * @fileoverview WorkflowDefinition + WorkflowRun — executable business flows.
 * Purpose: Persist API→map→agent→API workflows beyond agent instructions.
 * Downstream: apiWorkflowRunner, architect apply, heal, tests.
 */

import mongoose from "mongoose";

export const WORKFLOW_ENVIRONMENTS = ["draft", "sandbox", "canary", "production"];
export const WORKFLOW_STEP_KINDS = [
  "api_get",
  "transform",
  "agent_task",
  "api_write",
  "verify",
  "handoff",
  "emit_event",
];

const stepSchema = new mongoose.Schema(
  {
    id: { type: String, default: "" },
    kind: { type: String, enum: WORKFLOW_STEP_KINDS, required: true },
    name: { type: String, default: "" },
    /** HTTP */
    method: { type: String, default: "GET" },
    urlTemplate: { type: String, default: "" },
    headers: { type: mongoose.Schema.Types.Mixed, default: {} },
    bodyTemplate: { type: mongoose.Schema.Types.Mixed, default: null },
    authRef: { type: String, default: "" },
    /** transform / verify */
    map: {
      type: [
        {
          from: { type: String, default: "" },
          to: { type: String, default: "" },
          note: { type: String, default: "" },
        },
      ],
      default: [],
    },
    assertPath: { type: String, default: "" },
    assertEquals: { type: mongoose.Schema.Types.Mixed, default: undefined },
    /** agent */
    agentKey: { type: String, default: "" },
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: "Agent", default: null },
    goalTemplate: { type: String, default: "" },
    /** handoff / event */
    eventType: { type: String, default: "" },
    toAgentKey: { type: String, default: "" },
    timeoutMs: { type: Number, default: 30_000 },
    retry: {
      maxAttempts: { type: Number, default: 2 },
      backoffMs: { type: Number, default: 1000 },
    },
    idempotencyKeyTemplate: { type: String, default: "" },
  },
  { _id: false }
);

const workflowDefinitionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    blueprintId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BusinessBlueprint",
      default: null,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    environment: {
      type: String,
      enum: WORKFLOW_ENVIRONMENTS,
      default: "draft",
      index: true,
    },
    version: { type: Number, default: 1 },
    steps: { type: [stepSchema], default: [] },
    handoffs: {
      type: [
        {
          fromAgentKey: { type: String, default: "" },
          toAgentKey: { type: String, default: "" },
          onEvent: { type: String, default: "" },
          condition: { type: String, default: "" },
          payloadMap: { type: mongoose.Schema.Types.Mixed, default: {} },
          dedupeKeyTemplate: { type: String, default: "" },
          timeoutMs: { type: Number, default: 0 },
          triggerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Trigger",
            default: null,
          },
        },
      ],
      default: [],
    },
    incidentPolicy: {
      apiRetries: { type: Number, default: 3 },
      emailRetries: { type: Number, default: 3 },
      onExhausted: { type: String, default: "create_incident_notify_admin" },
    },
    agentKeyToId: { type: mongoose.Schema.Types.Mixed, default: {} },
    lastTestStatus: {
      type: String,
      enum: ["unknown", "passed", "failed", "skipped"],
      default: "unknown",
    },
    lastTestAt: { type: Date, default: null },
    active: { type: Boolean, default: true },
    /**
     * Snapshot before last promote — used for automatic / manual rollback.
     * Why: Canary→production must be reversible without re-compiling from blueprint.
     */
    rollbackSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    canaryStartedAt: { type: Date, default: null },
    canaryFailureThreshold: { type: Number, default: 0.4, min: 0.05, max: 1 },
    canaryMinSamples: { type: Number, default: 3, min: 1 },
  },
  { timestamps: true }
);

workflowDefinitionSchema.index({ user: 1, blueprintId: 1 });

const workflowRunSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    definition: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WorkflowDefinition",
      required: true,
      index: true,
    },
    correlationId: { type: String, default: "", index: true },
    environment: {
      type: String,
      enum: WORKFLOW_ENVIRONMENTS,
      default: "sandbox",
    },
    status: {
      type: String,
      enum: ["pending", "running", "waiting", "succeeded", "failed", "cancelled"],
      default: "pending",
      index: true,
    },
    stepIndex: { type: Number, default: 0 },
    context: { type: mongoose.Schema.Types.Mixed, default: {} },
    stepResults: { type: [mongoose.Schema.Types.Mixed], default: [] },
    error: { type: String, default: "" },
    attempt: { type: Number, default: 1 },
    parentRunId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WorkflowRun",
      default: null,
    },
    idempotencyKeys: { type: [String], default: [] },
  },
  { timestamps: true }
);

workflowRunSchema.index({ user: 1, correlationId: 1 });
workflowRunSchema.index({ user: 1, createdAt: -1 });

export const WorkflowDefinition = mongoose.model(
  "WorkflowDefinition",
  workflowDefinitionSchema
);
export const WorkflowRun = mongoose.model("WorkflowRun", workflowRunSchema);
