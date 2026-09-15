/**
 * @fileoverview Named LLM credential profiles per user.
 * Purpose: Save reusable API key / base URL / model sets and assign them to agents via dropdown.
 * Downstream: Agent.llm.profile; worker resolveLlmCredentialsForAgent; Settings → LLM profiles UI.
 */

import mongoose from "mongoose";
import { decryptSecret } from "../utils/crypto.js";

const llmProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    /** Display name in agent dropdown (e.g. "MiniMax production"). */
    name: { type: String, required: true, trim: true, maxlength: 120 },
    /** AES-encrypted OpenAI-compatible API key. */
    apiKeyEnc: { type: String, default: "" },
    baseUrl: { type: String, default: "", trim: true, maxlength: 500 },
    model: { type: String, default: "", trim: true, maxlength: 200 },
    /** Cost routing hint for automatic model selection. */
    tier: {
      type: String,
      enum: ["cheap", "standard", "premium"],
      default: "standard",
    },
    /** Optional USD estimate per 1k tokens for optimizer display. */
    costPer1kUsd: { type: Number, default: 0 },
  },
  { timestamps: true }
);

llmProfileSchema.index({ user: 1, name: 1 }, { unique: true });

/**
 * API shape for Settings → LLM profiles.
 * Why: operators asked to see full API keys on /settings/llms (not masked).
 * @param {object} doc
 * @returns {object}
 */
export function publicLlmProfile(doc) {
  if (!doc) return doc;
  const p = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  const apiKey = decryptSecret(p.apiKeyEnc || "") || "";
  const hasApiKey = Boolean(apiKey);
  delete p.apiKeyEnc;
  return {
    ...p,
    id: String(p._id),
    hasApiKey,
    apiKey,
    tier: p.tier || "standard",
    costPer1kUsd: Number(p.costPer1kUsd) || 0,
  };
}

export const LlmProfile = mongoose.model("LlmProfile", llmProfileSchema);
