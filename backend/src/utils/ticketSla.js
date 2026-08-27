/**
 * @fileoverview Ticket SLA — breach detection and escalation events.
 * Purpose: Enforce slaDueAt on open tickets.
 * Downstream: scheduler tick.
 */

import { Ticket } from "../models/Ticket.js";
import { emitEvent } from "./eventBus.js";

/**
 * @param {import('mongoose').Document} ticket
 * @param {number} [hours]
 */
export function setTicketSlaDue(ticket, hours = 24) {
  const h = Math.max(1, Number(hours) || 24);
  ticket.slaDueAt = new Date(Date.now() + h * 60 * 60 * 1000);
}

/**
 * Periodic SLA breach check.
 */
export async function tickTicketSla() {
  const now = new Date();
  const overdue = await Ticket.find({
    status: { $in: ["open", "assigned", "in_progress", "waiting_customer"] },
    slaDueAt: { $lte: now, $ne: null },
  }).limit(50);

  let breached = 0;
  for (const ticket of overdue) {
    if (ticket.attributes?.slaBreached) continue;
    ticket.attributes = { ...(ticket.attributes || {}), slaBreached: true };
    ticket.priority = ticket.priority === "urgent" ? "urgent" : "high";
    ticket.markModified("attributes");
    await ticket.save();
    await emitEvent({
      userId: ticket.user,
      type: "ticket.sla_breached",
      source: "ticket_sla",
      significance: "high",
      agentId: ticket.assigneeAgent,
      summary: `SLA breached: ${ticket.title}`,
      payload: { ticketId: String(ticket._id), slaDueAt: ticket.slaDueAt },
    });
    breached += 1;
  }
  return { breached, checked: overdue.length };
}
