/**
 * @fileoverview User model — auth identity + encrypted LLM/DBC settings.
 * Purpose: Own login credentials and per-user agent configuration for YamBot.
 * Downstream: auth routes, settings routes, extension task claiming.
 */

import mongoose from "mongoose";
import bcrypt from "bcryptjs";

/**
 * @typedef {object} UserSettings
 * @property {string} [llmApiKeyEnc]
 * @property {string} [llmBaseUrl]
 * @property {string} [llmModel]
 * @property {string} [dbcUsername]
 * @property {string} [dbcPasswordEnc]
 * @property {number} [maxSteps]
 * @property {boolean} [confirmBeforeSubmit]
 */

const settingsSchema = new mongoose.Schema(
  {
    llmApiKeyEnc: { type: String, default: "" },
    llmBaseUrl: { type: String, default: "https://api.openai.com/v1" },
    llmModel: { type: String, default: "gpt-4o-mini" },
    dbcUsername: { type: String, default: "" },
    dbcPasswordEnc: { type: String, default: "" },
    maxSteps: { type: Number, default: 25 },
    confirmBeforeSubmit: { type: Boolean, default: false },
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
