/**
 * @fileoverview CompanyMemory — operating memory / company digital twin facts.
 * Purpose: Durable knowledge about company structure, policies, systems, relationships.
 * Downstream: Injected into agent prompts, goal autonomy context.
 */

import mongoose from "mongoose";

export const MEMORY_CATEGORIES = [
  "company",
  "customer",
  "process",
  "policy",
  "system",
  "relationship",
  "history",
  "custom",
];

const companyMemorySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: MEMORY_CATEGORIES,
      default: "company",
      index: true,
    },
    key: { type: String, required: true, trim: true },
    value: { type: String, default: "", trim: true },
    confidence: { type: Number, default: 1, min: 0, max: 1 },
    source: { type: String, default: "manual", trim: true },
    validFrom: { type: Date, default: null },
    validUntil: { type: Date, default: null },
  },
  { timestamps: true }
);

companyMemorySchema.index({ user: 1, category: 1, key: 1 });

export const CompanyMemory = mongoose.model("CompanyMemory", companyMemorySchema);

/**
 * @param {import('mongoose').Types.ObjectId} userId
 * @param {number} [limit]
 * @returns {Promise<string>}
 */
export async function formatCompanyMemoryBlock(userId, limit = 40) {
  const rows = await CompanyMemory.find({ user: userId })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();
  if (!rows.length) return "";
  return rows.map((r) => `- [${r.category}] ${r.key}: ${r.value}`).join("\n");
}
