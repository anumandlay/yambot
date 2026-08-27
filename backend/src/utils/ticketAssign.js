/**
 * @fileoverview Ticket assignment — round-robin auto-assign from teams or agents.
 * Purpose: Auto-assign new tickets without manual queue triage.
 * Downstream: ticketEngine on create.
 */

import { Agent } from "../models/Agent.js";
import { Team } from "../models/Team.js";
import { CompanyMemory } from "../models/CompanyMemory.js";

/**
 * @param {string} userId
 */
async function getDefaultSupportAgentId(userId) {
  const mem = await CompanyMemory.findOne({ user: userId, key: "default_support_agent_id" }).lean();
  return mem?.value ? String(mem.value).trim() : "";
}

/**
 * @param {string} userId
 */
export async function pickAutoAssignAgent(userId) {
  const explicit = await getDefaultSupportAgentId(userId);
  if (explicit) {
    const agent = await Agent.findOne({ _id: explicit, user: userId, active: { $ne: false } });
    if (agent) return agent;
  }

  const team = await Team.findOne({ user: userId, defaultForTickets: true });
  if (team?.memberAgents?.length) {
    const idx = team.roundRobinIndex % team.memberAgents.length;
    const agentId = team.memberAgents[idx];
    team.roundRobinIndex = idx + 1;
    await team.save();
    const agent = await Agent.findOne({ _id: agentId, user: userId });
    if (agent) return agent;
  }

  const agent = await Agent.findOne({ user: userId, active: { $ne: false } })
    .sort({ updatedAt: -1 })
    .select("_id name");
  return agent;
}

/**
 * @param {import('mongoose').Document} ticket
 */
export async function autoAssignTicket(ticket) {
  if (ticket.assigneeAgent) return ticket;
  const agent = await pickAutoAssignAgent(String(ticket.user));
  if (!agent) return ticket;
  ticket.assigneeAgent = agent._id;
  ticket.status = "assigned";
  await ticket.save();
  return ticket;
}
