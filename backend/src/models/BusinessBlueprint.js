/**
 * @fileoverview BusinessBlueprint — persisted Architect plan / business memory seed.
 * Purpose: Store understanding, workflow graph, checklist, and links after Approve & Build.
 * Downstream: architect routes/chat, BusinessArchitectPage, future change-in-English.
 */

import mongoose from "mongoose";

export const BLUEPRINT_STATUSES = ["draft", "approved", "built"];

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
    /** gathering | understanding | ready */
    stage: { type: String, default: "gathering", trim: true },
    profileId: { type: String, default: "", trim: true },
    /** Chat transcript (secrets redacted). */
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
    /** Full architect blueprint JSON (graph, components, checklist, plan, uiMap, …). */
    blueprint: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Non-secret answer snapshot for resume (passwords not stored here). */
    answersMeta: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAgentIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Agent" }],
      default: [],
    },
    createdTriggerIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Trigger" }],
      default: [],
    },
    builtAt: { type: Date, default: null },
  },
  { timestamps: true }
);

businessBlueprintSchema.index({ user: 1, updatedAt: -1 });

export const BusinessBlueprint = mongoose.model("BusinessBlueprint", businessBlueprintSchema);
