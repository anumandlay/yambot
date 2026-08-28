/**
 * @fileoverview Named LLM credential profiles per user.
 * Purpose: Save reusable API key / base URL / model sets and assign them to agents via dropdown.
 * Downstream: Agent.llm.profile; worker resolveLlmCredentialsForAgent; Settings → LLM profiles UI.
 */

import mongoose from "mongoose";

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
  },
  { timestamps: true }
);

llmProfileSchema.index({ user: 1, name: 1 }, { unique: true });

/**
 * Safe API shape (no raw key).
 * @param {object} doc
 * @returns {object}
 */
export function publicLlmProfile(doc) {
  if (!doc) return doc;
  const p = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  const hasApiKey = Boolean(p.apiKeyEnc);
  delete p.apiKeyEnc;
  return {
    ...p,
    id: String(p._id),
    hasApiKey,
    apiKeyMasked: hasApiKey ? "••••••••" : "",
  };
}

export const LlmProfile = mongoose.model("LlmProfile", llmProfileSchema);
