/**
 * @fileoverview Ticket engine — create from inbound email, assign, status transitions.
 * Purpose: Support queue automation; email.received → ticket when not a campaign reply.
 * Downstream: emailInboxWatcher, tickets routes, worker actions.
 */

import { Ticket, TICKET_STATUSES } from "../models/Ticket.js";
import { Entity, appendEntityObservation } from "../models/Entity.js";
import { emitEvent } from "./eventBus.js";
import { autoAssignTicket } from "./ticketAssign.js";
import { setTicketSlaDue } from "./ticketSla.js";
import { startSupportProcessForTicket, generateTicketPublicToken } from "./supportProcess.js";
import { ensureDefaultTicketTriageTrigger } from "./ticketTriageTrigger.js";
import { resolveAgentTerritory } from "./entityTerritory.js";

/**
 * Normalizes subject for thread matching (strip Re:/Fwd:).
 * @param {string} subject
 */
export function normalizeEmailSubject(subject) {
  return String(subject || "")
    .replace(/^(re|fwd):\s*/gi, "")
    .trim()
    .toLowerCase()
    .slice(0, 200);
}

/**
 * Builds thread key from sender email + normalized subject.
 * @param {string} from
 * @param {string} subject
 */
export function buildEmailThreadKey(from, subject) {
  const emailMatch = String(from || "").match(/[\w.+-]+@[\w.-]+\.\w+/i);
  const email = emailMatch ? emailMatch[0].toLowerCase() : String(from || "").toLowerCase();
  return `${email}::${normalizeEmailSubject(subject)}`;
}

/**
 * Creates mirror Entity (type ticket) for unified CRM search.
 * @param {import('mongoose').Document} ticket
 */
export async function syncTicketMirrorEntity(ticket) {
  if (ticket.mirrorEntity) return ticket.mirrorEntity;

  const email = ticket.attributes?.from || "";
  const entity = await Entity.create({
    user: ticket.user,
    group: ticket.group || null,
    type: "ticket",
    name: ticket.title.slice(0, 200),
    status: ticket.status,
    externalId: String(ticket._id),
    attributes: {
      ticketId: String(ticket._id),
      priority: ticket.priority,
      from: email,
    },
  });
  ticket.mirrorEntity = entity._id;
  await ticket.save();
  return entity._id;
}

/**
 * Post-create automation: SLA, assign, process, mirror entity, triage trigger seed.
 * @param {import('mongoose').Document} ticket
 * @param {{ isNew?: boolean, agentId?: string }} [opts]
 */
export async function finalizeNewTicket(ticket, opts = {}) {
  if (!ticket.publicToken) {
    ticket.publicToken = generateTicketPublicToken();
  }
  if (!ticket.slaDueAt) {
    setTicketSlaDue(ticket, ticket.priority === "urgent" ? 4 : 24);
  }
  await ticket.save();
  await syncTicketMirrorEntity(ticket);
  await autoAssignTicket(ticket);
  await startSupportProcessForTicket(ticket);
  if (opts.isNew) {
    await ensureDefaultTicketTriageTrigger(String(ticket.user), opts.agentId);
  }
}

/**
 * Creates or updates a ticket from inbound email (skips when campaign enrollment handles reply).
 * @param {object} opts
 */
export async function maybeCreateTicketFromEmail(opts) {
  const {
    userId,
    agentId,
    from,
    subject,
    snippet,
    emailMessageId,
    entityId,
    enrollmentId,
    skipIfEnrollment,
  } = opts;

  if (skipIfEnrollment && enrollmentId) return null;

  const threadKey = buildEmailThreadKey(from, subject);
  const { groupId } = await resolveAgentTerritory(userId, agentId);
  let ticket = await Ticket.findOne({
    user: userId,
    group: groupId,
    emailThreadKey: threadKey,
    status: { $nin: ["resolved", "closed"] },
  });

  let isNew = false;
  if (!ticket) {
    isNew = true;
    ticket = await Ticket.create({
      user: userId,
      group: groupId,
      title: String(subject || "Inbound email").slice(0, 300),
      description: String(snippet || "").slice(0, 4000),
      status: "open",
      priority: "normal",
      requesterEntity: entityId || null,
      emailThreadKey: threadKey,
      emailMessageIds: emailMessageId ? [emailMessageId] : [],
      source: "email",
      attributes: { from: String(from || "").slice(0, 300) },
    });

    await finalizeNewTicket(ticket, { isNew: true, agentId });

    await emitEvent({
      userId,
      type: "ticket.created",
      source: "ticket_engine",
      significance: "medium",
      agentId: agentId || ticket.assigneeAgent || null,
      summary: `New ticket: ${ticket.title}`.slice(0, 500),
      payload: {
        ticketId: String(ticket._id),
        entityId: entityId ? String(entityId) : ticket.mirrorEntity ? String(ticket.mirrorEntity) : null,
        emailMessageId: emailMessageId ? String(emailMessageId) : null,
        assigneeAgentId: ticket.assigneeAgent ? String(ticket.assigneeAgent) : null,
      },
    });
  } else {
    if (emailMessageId && !ticket.emailMessageIds.some((id) => String(id) === String(emailMessageId))) {
      ticket.emailMessageIds.push(emailMessageId);
    }
    if (snippet) {
      ticket.description = `${ticket.description}\n\n---\n${String(snippet).slice(0, 2000)}`.slice(0, 8000);
    }
    if (ticket.status === "waiting_customer") ticket.status = "open";
    await ticket.save();
  }

  if (entityId) {
    const entity = await Entity.findById(entityId);
    if (entity) {
      appendEntityObservation(entity, {
        source: "ticket",
        kind: "ticket",
        content: `Ticket ${ticket._id}: ${ticket.title} (${ticket.status})`,
        meta: { ticketId: String(ticket._id) },
      });
      await entity.save();
    }
  }

  return ticket;
}

/**
 * @param {import('mongoose').Document} ticket
 * @param {string} status
 * @param {object} [opts]
 */
export async function setTicketStatus(ticket, status, opts = {}) {
  if (!TICKET_STATUSES.includes(status)) {
    throw new Error(`Invalid ticket status: ${status}`);
  }
  ticket.status = status;
  if (opts.assigneeAgentId) ticket.assigneeAgent = opts.assigneeAgentId;
  if (opts.priority && ["low", "normal", "high", "urgent"].includes(opts.priority)) {
    ticket.priority = opts.priority;
  }
  await ticket.save();

  if (ticket.mirrorEntity) {
    await Entity.updateOne({ _id: ticket.mirrorEntity }, { $set: { status } });
  }

  await emitEvent({
    userId: ticket.user,
    type: "ticket.updated",
    source: "ticket_engine",
    agentId: ticket.assigneeAgent,
    summary: `Ticket ${ticket.title} → ${status}`,
    payload: { ticketId: String(ticket._id), status },
  });
  return ticket;
}
