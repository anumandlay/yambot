/**
 * @fileoverview Default ticket.created triage trigger — seeds once per user.
 * Purpose: Auto-enqueue agent triage when new tickets arrive.
 * Downstream: ticketEngine finalizeNewTicket.
 */

import { Trigger } from "../models/Trigger.js";
import { Agent } from "../models/Agent.js";

const TRIGGER_NAME = "Auto-triage new tickets";

/**
 * @param {string} userId
 * @param {string} [preferredAgentId]
 */
export async function ensureDefaultTicketTriageTrigger(userId, preferredAgentId) {
  const existing = await Trigger.findOne({ user: userId, name: TRIGGER_NAME });
  if (existing) return existing;

  let agentId = preferredAgentId;
  if (!agentId) {
    const agent = await Agent.findOne({ user: userId, active: { $ne: false } }).sort({ updatedAt: -1 });
    agentId = agent?._id;
  }
  if (!agentId) return null;

  return Trigger.create({
    user: userId,
    name: TRIGGER_NAME,
    enabled: true,
    type: "event",
    agent: agentId,
    config: { eventType: "ticket.created" },
    action: "enqueue_task",
    actionConfig: {
      instructions: [
        "A new support ticket was created.",
        "Use ticketId from context. Call search_tickets or get ticket details.",
        "Set status in_progress, investigate the issue, add_entity_observation on the requester.",
        "Reply via send_email if appropriate. When done, update_ticket status resolved.",
        "Include KPI: tickets_resolved +1 in finish summary if resolved.",
      ].join(" "),
      injectTicketContext: true,
    },
  });
}
