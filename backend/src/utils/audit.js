/**
 * @fileoverview Audit log writer — governance Layer 5.
 * Purpose: Central helper so routes record consistent audit events without duplicating schema logic.
 * Downstream: goals, chats, worker, agents routes.
 */

import { AuditEvent } from "../models/AuditEvent.js";

/**
 * Records an audit event (fire-and-forget safe — errors logged, not thrown).
 * @param {{
 *   userId: string,
 *   action: string,
 *   agentId?: string|null,
 *   taskId?: string|null,
 *   goalId?: string|null,
 *   detail?: string,
 *   meta?: object,
 * }} opts
 */
export async function writeAudit(opts) {
  try {
    await AuditEvent.create({
      user: opts.userId,
      action: String(opts.action || "unknown").slice(0, 120),
      agent: opts.agentId || null,
      task: opts.taskId || null,
      goal: opts.goalId || null,
      detail: String(opts.detail || "").slice(0, 2000),
      meta: opts.meta && typeof opts.meta === "object" ? opts.meta : {},
    });
  } catch (err) {
    console.error("[audit] write failed:", err?.message || err);
  }
}
