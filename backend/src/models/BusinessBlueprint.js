/**
 * @fileoverview BusinessBlueprint — Architect business memory + Phase 2 runtime fields.
 * Purpose: Persist understanding, blueprint versions, simulation, tests, changes, data maps.
 * Downstream: architect routes, BusinessArchitectPage hub.
 */

import mongoose from "mongoose";

export const BLUEPRINT_STATUSES = ["draft", "approved", "built"];

const changeEntrySchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    request: { type: String, default: "" },
    summary: { type: String, default: "" },
    impact: { type: mongoose.Schema.Types.Mixed, default: {} },
    approved: { type: Boolean, default: false },
    applied: { type: Boolean, default: false },
  },
  { _id: true }
);

const businessBlueprintSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, default: "", trim: true, maxlength: 200 },
    status: {
      type: String,
      enum: BLUEPRINT_STATUSES,
      default: "draft",
      index: true,
    },
    stage: { type: String, default: "gathering", trim: true },
    profileId: { type: String, default: "", trim: true },
    messages: {
      type: [
        {
          role: { type: String, enum: ["user", "assistant"], required: true },
          content: { type: String, default: "" },
          at: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    understanding: {
      objective: { type: String, default: "" },
      bullets: { type: [String], default: [] },
      assumptions: { type: [String], default: [] },
      confirmed: { type: Boolean, default: false },
    },
    /** Business rules remembered across change-in-English sessions. */
    businessRules: { type: [String], default: [] },
    blueprint: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Prior blueprint snapshots for change-impact diffs. */
    versions: {
      type: [
        {
          at: { type: Date, default: Date.now },
          label: { type: String, default: "" },
          blueprint: { type: mongoose.Schema.Types.Mixed, default: null },
        },
      ],
      default: [],
    },
    dataMaps: {
      type: [
        {
          source: { type: String, default: "" },
          target: { type: String, default: "" },
          note: { type: String, default: "" },
        },
      ],
      default: [],
    },
    answersMeta: { type: mongoose.Schema.Types.Mixed, default: {} },
    /**
     * Encrypted JSON of Architect answers (includes mailbox passwords).
     * Why: public blueprint strips secrets; Apply must still create configured email agents after refresh.
     */
    answersSecretsEnc: { type: String, default: "" },
    createdAgentIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Agent" }],
      default: [],
    },
    createdTriggerIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Trigger" }],
      default: [],
    },
    lastSimulation: { type: mongoose.Schema.Types.Mixed, default: null },
    simulationApprovedAt: { type: Date, default: null },
    lastTestRun: { type: mongoose.Schema.Types.Mixed, default: null },
    changeHistory: { type: [changeEntrySchema], default: [] },
    /** Pending change proposal awaiting approval. */
    pendingChange: { type: mongoose.Schema.Types.Mixed, default: null },
    incidentPolicy: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({
        apiRetries: 3,
        emailRetries: 3,
        onExhausted: "create_incident_notify_admin",
        notifyEmail: "",
      }),
    },
    builtAt: { type: Date, default: null },
  },
  { timestamps: true }
);

businessBlueprintSchema.index({ user: 1, updatedAt: -1 });
businessBlueprintSchema.index({ user: 1, status: 1 });

export const BusinessBlueprint = mongoose.model("BusinessBlueprint", businessBlueprintSchema);
