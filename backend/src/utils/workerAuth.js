/**
 * @fileoverview Per-agent cloud-worker credentials.
 * Purpose: Auto-provisioned containers authenticate without storing the user's website password.
 * Downstream: agent create/update; `/api/auth/worker-login`; computer-manager decrypts token for env.
 */

import crypto from "node:crypto";
import { encryptSecret } from "./crypto.js";

/**
 * @param {string} token
 * @returns {string}
 */
export function hashWorkerToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

/**
 * Creates a new worker token pair for an agent document fields.
 * @returns {{ token: string, workerTokenHash: string, workerTokenEnc: string }}
 */
export function issueWorkerToken() {
  const token = crypto.randomBytes(32).toString("hex");
  return {
    token,
    workerTokenHash: hashWorkerToken(token),
    workerTokenEnc: encryptSecret(token),
  };
}

/**
 * Docker-safe container name for an agent id.
 * @param {string|import('mongoose').Types.ObjectId} agentId
 * @returns {string}
 */
export function containerNameForAgent(agentId) {
  const id = String(agentId).replace(/[^a-zA-Z0-9]/g, "").slice(-16).toLowerCase();
  return `yambot-agent-${id || "box"}`;
}
