/**
 * @fileoverview Reusable business workflow templates cloned from Architect blueprints.
 * Purpose: “Create the same system for Canada” without rebuilding from zero.
 * Downstream: /api/architect/templates, BusinessArchitectPage.
 */

import mongoose from "mongoose";

const businessTemplateSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, default: "", trim: true, maxlength: 1000 },
    /** Snapshot of architect blueprint JSON (no secrets). */
    blueprint: { type: mongoose.Schema.Types.Mixed, required: true },
    understanding: { type: mongoose.Schema.Types.Mixed, default: {} },
    dataMaps: { type: [mongoose.Schema.Types.Mixed], default: [] },
    checklist: { type: mongoose.Schema.Types.Mixed, default: {} },
    sourceBlueprintId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BusinessBlueprint",
      default: null,
    },
  },
  { timestamps: true }
);

businessTemplateSchema.index({ user: 1, name: 1 });

export const BusinessTemplate = mongoose.model("BusinessTemplate", businessTemplateSchema);
