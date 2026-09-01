/**
 * @fileoverview Centralized environment reader for YamBot API.
 * Purpose: Single source of truth for runtime config across local vs production.
 * Inputs: process.env (loaded via node --env-file*).
 * Downstream: index.js, auth JWT, mongoose connect, settings encryption.
 */

/**
 * @typedef {object} Env
 * @property {string} NODE_ENV
 * @property {number} PORT
 * @property {string} PUBLIC_API_URL
 * @property {string} MONGODB_URI
 * @property {string} JWT_SECRET
 * @property {string} JWT_EXPIRES_IN
 * @property {string} SETTINGS_CRYPTO_KEY
 * @property {string} CORS_ORIGINS
 * @property {string} DEFAULT_LLM_API_KEY
 * @property {string} DEFAULT_LLM_BASE_URL
 * @property {string} DEFAULT_LLM_MODEL
 * @property {string} COMPUTER_MANAGER_URL
 * @property {string} PERSONAL_VPS_URL
 * @property {string} SUPERADMIN_EMAILS
 * @property {string} SUPERADMIN_BOOTSTRAP_EMAIL
 * @property {string} SUPERADMIN_BOOTSTRAP_PASSWORD
 * @property {string} SUPERADMIN_BOOTSTRAP_NAME
 */

import {
  DEFAULT_LLM_BASE_URL as LLM_BASE,
  DEFAULT_LLM_MODEL as LLM_MODEL,
} from "./llmDefaults.js";

/** @type {Env} */
export const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: Number(process.env.PORT || 4000),
  PUBLIC_API_URL: process.env.PUBLIC_API_URL || "http://localhost:4000",
  MONGODB_URI: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/yambot",
  JWT_SECRET: process.env.JWT_SECRET || "dev-insecure-secret",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "7d",
  SETTINGS_CRYPTO_KEY:
    process.env.SETTINGS_CRYPTO_KEY || "dev-settings-crypto-key-change-me-32",
  CORS_ORIGINS: process.env.CORS_ORIGINS || "http://localhost:5173",
  // Why: optional site-wide LLM so operators do not re-enter keys on every device.
  DEFAULT_LLM_API_KEY: process.env.DEFAULT_LLM_API_KEY || "",
  DEFAULT_LLM_BASE_URL: process.env.DEFAULT_LLM_BASE_URL || LLM_BASE,
  DEFAULT_LLM_MODEL: process.env.DEFAULT_LLM_MODEL || LLM_MODEL,
  /** Internal computer-manager HTTP (Compose network). */
  COMPUTER_MANAGER_URL: process.env.COMPUTER_MANAGER_URL || "http://computer-manager:4050",
  /** Isolated personal VPS manager (super-admin only). */
  PERSONAL_VPS_URL: process.env.PERSONAL_VPS_URL || "http://personal-vps:4060",
  /** Public web app URL for Stripe redirects (defaults to first CORS origin). */
  PUBLIC_WEB_URL:
    process.env.PUBLIC_WEB_URL ||
    (process.env.CORS_ORIGINS || "http://localhost:5173").split(",")[0].trim(),
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "",
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || "",
  /** Comma-separated emails always treated as superadmin (promoted on boot). */
  SUPERADMIN_EMAILS: process.env.SUPERADMIN_EMAILS || "",
  /** Optional first-run bootstrap super-admin (created if missing). */
  SUPERADMIN_BOOTSTRAP_EMAIL: process.env.SUPERADMIN_BOOTSTRAP_EMAIL || "",
  SUPERADMIN_BOOTSTRAP_PASSWORD: process.env.SUPERADMIN_BOOTSTRAP_PASSWORD || "",
  SUPERADMIN_BOOTSTRAP_NAME: process.env.SUPERADMIN_BOOTSTRAP_NAME || "Platform Admin",
};
