/**
 * @fileoverview Support process — default SOP template and auto-start on tickets.
 * Purpose: Ticket → process instance (Triage → Investigate → Resolve).
 * Downstream: ticketEngine post-create hooks.
 */

import crypto from "node:crypto";
import { ProcessDefinition, ProcessInstance } from "../models/Process.js";

export const SUPPORT_PROCESS_NAME = "Support ticket SOP";

const DEFAULT_STAGES = [
  { id: "triage", name: "Triage", description: "Classify and prioritize" },
  { id: "investigate", name: "Investigate", description: "Gather context and reproduce" },
  { id: "resolve", name: "Resolve", description: "Fix and confirm with customer" },
  { id: "closed", name: "Closed", description: "Ticket complete" },
];

const DEFAULT_TRANSITIONS = [
  { from: "triage", to: "investigate" },
  { from: "investigate", to: "resolve" },
  { from: "resolve", to: "closed" },
  { from: "triage", to: "closed" },
];

/**
 * @param {string} userId
 */
export async function ensureSupportProcessDefinition(userId) {
  let def = await ProcessDefinition.findOne({ user: userId, name: SUPPORT_PROCESS_NAME });
  if (!def) {
    def = await ProcessDefinition.create({
      user: userId,
      name: SUPPORT_PROCESS_NAME,
      description: "Default support workflow for tickets",
      stages: DEFAULT_STAGES,
      transitions: DEFAULT_TRANSITIONS,
    });
  }
  return def;
}

/**
 * @param {import('mongoose').Document} ticket
 */
export async function startSupportProcessForTicket(ticket) {
  if (ticket.processInstance) return null;
  const def = await ensureSupportProcessDefinition(ticket.user);
  const instance = await ProcessInstance.create({
    user: ticket.user,
    definition: def._id,
    entity: ticket.requesterEntity || ticket.mirrorEntity || null,
    currentStage: "triage",
    history: [{ stage: "triage", note: `Auto-started for ticket ${ticket._id}` }],
  });
  ticket.processInstance = instance._id;
  await ticket.save();
  return instance;
}

/**
 * @returns {string}
 */
export function generateTicketPublicToken() {
  return crypto.randomBytes(24).toString("hex");
}
