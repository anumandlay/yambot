/**
 * @fileoverview User model — auth identity + encrypted LLM/DBC settings.
 * Purpose: Own login credentials and per-user agent configuration for YamBot.
 * Downstream: auth routes, settings routes, cloud worker task claiming.
 */

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
} from "../utils/llmDefaults.js";

/**
 * @typedef {object} UserSettings
 * @property {string} [llmApiKeyEnc]
 * @property {string} [llmBaseUrl]
 * @property {string} [llmModel]
 * @property {string} [visionApiKeyEnc]
 * @property {string} [visionBaseUrl]
 * @property {string} [visionModel]
 * @property {string} [dbcUsername]
 * @property {string} [dbcPasswordEnc]
 * @property {number} [maxSteps]
 * @property {boolean} [confirmBeforeSubmit]
 * @property {boolean} [helpEnabled]
 */

const settingsSchema = new mongoose.Schema(
  {
    llmApiKeyEnc: { type: String, default: "" },
    /** api_key | oauth — how the worker authenticates to the LLM API. */
    llmAuthMode: { type: String, enum: ["api_key", "oauth"], default: "api_key" },
    llmOAuthProvider: { type: String, default: "" },
    llmOAuthAccessTokenEnc: { type: String, default: "" },
    llmOAuthRefreshTokenEnc: { type: String, default: "" },
    llmOAuthExpiresAt: { type: Date, default: null },
    llmOAuthAccountLabel: { type: String, default: "" },
    /** Per-provider OAuth app credentials (encrypted) when server env is unset. */
    llmOAuthApps: { type: mongoose.Schema.Types.Mixed, default: {} },
    llmBaseUrl: { type: String, default: DEFAULT_LLM_BASE_URL },
    llmModel: { type: String, default: DEFAULT_LLM_MODEL },
    /** Optional separate credentials for multimodal (viewport screenshot) steps. */
    visionApiKeyEnc: { type: String, default: "" },
    visionBaseUrl: { type: String, default: "" },
    visionModel: { type: String, default: "" },
    dbcUsername: { type: String, default: "" },
    dbcPasswordEnc: { type: String, default: "" },
    maxSteps: { type: Number, default: 0 },
    confirmBeforeSubmit: { type: Boolean, default: false },
    /** UI preference — show contextual ? tooltips and How To navigation. */
    helpEnabled: { type: Boolean, default: true },
    /** Layer 2 — global policy defaults */
    requireApprovalForSubmit: { type: Boolean, default: false },
    blockedUrlPatterns: { type: [String], default: [] },
    monthlyBudgetUsd: { type: Number, default: 0 },
    dailyBudgetUsd: { type: Number, default: 0 },
    maxTaskMinutes: { type: Number, default: 0 },
    escalateWaitingMinutes: { type: Number, default: 30 },
    /** Layer 4 — hosts allowed for http_request tool (empty = any non-blocked) */
    httpAllowHosts: { type: [String], default: [] },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true },
    /** SaaS platform role — superadmin sees all tenants in /admin. */
    role: {
      type: String,
      enum: ["user", "superadmin"],
      default: "user",
      index: true,
    },
    /** Prepaid wallet balance in USD cents (Stripe top-ups + admin credits). */
    walletBalanceCents: { type: Number, default: 0, min: 0 },
    settings: { type: settingsSchema, default: () => ({}) },
  },
  { timestamps: true }
);

/**
 * Hashes a plaintext password for storage.
 * @param {string} password
 * @returns {Promise<string>}
 */
userSchema.statics.hashPassword = async function hashPassword(password) {
  return bcrypt.hash(password, 12);
};

/**
 * Verifies a plaintext password against this user.
 * @param {string} password
 * @returns {Promise<boolean>}
 */
userSchema.methods.verifyPassword = async function verifyPassword(password) {
  return bcrypt.compare(password, this.passwordHash);
};

export const User = mongoose.model("User", userSchema);
