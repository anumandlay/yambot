/**
 * @fileoverview Audit export — compliance bundle for tickets, tasks, campaigns.
 * Purpose: Exportable audit trail for governance.
 * Downstream: GET /api/audit/export.
 */

import { Ticket } from "../models/Ticket.js";
import { Task } from "../models/Task.js";
import { AuditEvent } from "../models/AuditEvent.js";
import { EmailMessage } from "../models/EmailMessage.js";

/**
 * @param {string} userId
 * @param {{ since?: Date, limit?: number }} [opts]
 */
export async function buildAuditExport(userId, opts = {}) {
  const since = opts.since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const limit = Math.min(500, Number(opts.limit) || 200);

  const [tickets, tasks, audits, emails] = await Promise.all([
    Ticket.find({ user: userId, updatedAt: { $gte: since } }).sort({ updatedAt: -1 }).limit(limit).lean(),
    Task.find({ user: userId, updatedAt: { $gte: since } })
      .select("status goal resultSummary agent completedAt createdAt ticketRef entityRef")
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean(),
    AuditEvent.find({ user: userId, createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(limit).lean(),
    EmailMessage.find({ user: userId, createdAt: { $gte: since } })
      .select("direction subject from to createdAt entity")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    since: since.toISOString(),
    counts: { tickets: tickets.length, tasks: tasks.length, audits: audits.length, emails: emails.length },
    tickets,
    tasks,
    audits,
    emails,
  };
}
