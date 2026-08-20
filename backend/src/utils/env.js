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
 */

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
};
