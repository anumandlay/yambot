/**
 * @fileoverview Company context blocks for agent tasks — entities, memory, enrollments.
 * Purpose: Inject structured company data into every worker run (Phase 1 company brain).
 * Downstream: enqueueTask.js, worker entity tools.
 */

import { Entity } from "../models/Entity.js";
import { formatCompanyMemoryBlock } from "../models/CompanyMemory.js";
import { Enrollment } from "../models/Campaign.js";
import { Ticket } from "../models/Ticket.js";
import { EmailMessage } from "../models/EmailMessage.js";
import { applyTerritoryFilter, resolveAgentTerritory } from "./entityTerritory.js";

/**
 * @param {object} entity
 * @returns {string}
 */
export function formatEntityBlock(entity) {
  if (!entity) return "";
  const obs = Array.isArray(entity.observations)
    ? entity.observations.slice(-8).map((o) => `  - [${o.kind || "note"}] ${o.content}`).join("\n")
    : "";
  const attrs =
    entity.attributes && typeof entity.attributes === "object"
      ? Object.entries(entity.attributes)
          .slice(0, 12)
          .map(([k, v]) => `  ${k}: ${String(v)}`)
          .join("\n")
      : "";
  return [
    `ENTITY ${entity._id} (${entity.type || "custom"}): ${entity.name}`,
    entity.kind ? `Table/kind: ${entity.kind}` : "",
    entity.status ? `Status: ${entity.status}` : "",
    entity.group ? `Territory group: ${entity.group}` : "Territory group: (ungrouped)",
    entity.externalId ? `External ID: ${entity.externalId}` : "",
    attrs ? `Attributes:\n${attrs}` : "",
    obs ? `Recent observations:\n${obs}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Builds company + entity context prepended to worker goals.
 * @param {string} userId
 * @param {{
 *   agentId?: string|null,
 *   entityId?: string|null,
 *   enrollmentId?: string|null,
 *   ticketId?: string|null,
 *   entityLimit?: number,
 * }} [opts]
 * @returns {Promise<string>}
 */
export async function buildCompanyContextBlock(userId, opts = {}) {
  const parts = [];
  const memory = await formatCompanyMemoryBlock(userId, 25);
  if (memory) {
    parts.push(`COMPANY MEMORY:\n${memory}`);
  }

  if (opts.entityId) {
    const primary = await Entity.findOne({ _id: opts.entityId, user: userId }).lean();
    if (primary) {
      parts.push(`PRIMARY ${formatEntityBlock(primary)}`);
    }
  }

  if (opts.enrollmentId) {
    const enr = await Enrollment.findOne({ _id: opts.enrollmentId, user: userId })
      .populate("campaign", "name status")
      .populate("entity", "name type status attributes")
      .lean();
    if (enr) {
      parts.push(
        [
          "CAMPAIGN ENROLLMENT:",
          `Enrollment: ${enr._id}`,
          enr.campaign?.name ? `Campaign: ${enr.campaign.name}` : "",
          `Stage: ${enr.stage || "queued"}`,
          enr.nextActionAt ? `Next action: ${new Date(enr.nextActionAt).toISOString()}` : "",
          enr.entity ? formatEntityBlock(enr.entity) : "",
        ]
          .filter(Boolean)
          .join("\n")
      );
    }
  }

  if (opts.ticketId) {
    const ticket = await Ticket.findOne({ _id: opts.ticketId, user: userId }).lean();
    if (ticket) {
      const emails = await EmailMessage.find({ _id: { $in: ticket.emailMessageIds || [] } })
        .sort({ createdAt: 1 })
        .limit(10)
        .lean();
      parts.push(
        [
          "SUPPORT TICKET:",
          `ticketId: ${ticket._id}`,
          `Title: ${ticket.title}`,
          `Status: ${ticket.status} · Priority: ${ticket.priority}`,
          ticket.slaDueAt ? `SLA due: ${new Date(ticket.slaDueAt).toISOString()}` : "",
          `Description: ${String(ticket.description || "").slice(0, 1200)}`,
          emails.length
            ? `Email thread:\n${emails.map((m) => `- ${m.direction} ${m.from}: ${m.subject}`).join("\n")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      );
    }
  }

  const entityLimit = Math.min(15, Number(opts.entityLimit) || 8);
  const agentId = opts.agentId ? String(opts.agentId) : null;
  if (agentId && !opts.entityId) {
    const { groupId } = await resolveAgentTerritory(userId, agentId);
    const territoryFilter = applyTerritoryFilter({ user: userId }, groupId);
    const related = await Entity.find(territoryFilter)
      .sort({ updatedAt: -1 })
      .limit(entityLimit)
      .lean();
    if (related.length) {
      parts.push(
        `ENTITIES IN THIS AGENT'S TERRITORY (${related.length}):\n${related.map((e) => formatEntityBlock(e)).join("\n\n")}`
      );
    }
  }

  if (!opts.entityId && !agentId) {
    const recent = await Entity.find({ user: userId })
      .sort({ updatedAt: -1 })
      .limit(5)
      .lean();
    if (recent.length) {
      parts.push(
        `RECENT ENTITIES (use search_entities / get_entity for more):\n${recent.map((e) => `- ${e._id} ${e.type}: ${e.name} (${e.status})`).join("\n")}`
      );
    }
  }

  if (!parts.length) return "";
  return `${parts.join("\n\n")}\n\n---\n\n`;
}

/**
 * @param {string} goalText
 * @param {string} contextBlock
 * @returns {string}
 */
export function prependContextToGoal(goalText, contextBlock) {
  const goal = String(goalText || "").trim();
  const ctx = String(contextBlock || "").trim();
  if (!ctx) return goal;
  if (goal.startsWith("COMPANY MEMORY:") || goal.includes("PRIMARY ENTITY")) return goal;
  return `${ctx}${goal}`;
}
