/**
 * @fileoverview Territory (agent-group) scoping for Company entities / leads.
 * Purpose: Agents in the same agent group (e.g. USA) share one lead DB; other groups are isolated.
 * Downstream: workerEntities, entities API, campaignEngine, entityContext, CSV import, tickets.
 */

import { Agent } from "../models/Agent.js";

/**
 * Resolves the creating/searching agent's territory group id.
 * @param {string} userId
 * @param {string|null|undefined} agentId
 * @returns {Promise<{ agentId: string|null, groupId: string|null }>}
 */
export async function resolveAgentTerritory(userId, agentId) {
  const aid = agentId ? String(agentId).trim() : "";
  if (!aid) return { agentId: null, groupId: null };
  const agent = await Agent.findOne({ _id: aid, user: userId }).select("group").lean();
  if (!agent) return { agentId: aid, groupId: null };
  return {
    agentId: String(agent._id),
    groupId: agent.group ? String(agent.group) : null,
  };
}

/**
 * Applies territory filter onto an Entity query filter.
 * Why: grouped agents only see their group's leads; ungrouped agents only see ungrouped leads
 * (not the whole account — that would break country isolation).
 * @param {object} filter
 * @param {string|null} groupId — null means ungrouped-only
 * @returns {object}
 */
export function applyTerritoryFilter(filter, groupId) {
  const out = { ...filter };
  if (groupId) out.group = groupId;
  else out.group = null;
  return out;
}

/**
 * Parses Company UI / API groupId query: empty = all, "ungrouped" = null group, else ObjectId.
 * @param {unknown} raw
 * @returns {{ mode: "all"|"ungrouped"|"group", groupId: string|null }}
 */
export function parseGroupIdQuery(raw) {
  const v = String(raw ?? "").trim();
  if (!v || v === "all") return { mode: "all", groupId: null };
  if (v === "ungrouped") return { mode: "ungrouped", groupId: null };
  return { mode: "group", groupId: v };
}

/**
 * Applies list filter from Company UI group picker (includes "all").
 * @param {object} filter
 * @param {unknown} rawGroupId
 * @returns {object}
 */
export function applyGroupIdQuery(filter, rawGroupId) {
  const parsed = parseGroupIdQuery(rawGroupId);
  if (parsed.mode === "all") return filter;
  return applyTerritoryFilter(filter, parsed.mode === "ungrouped" ? null : parsed.groupId);
}

/**
 * Whether a document with a `group` field belongs to the agent's territory.
 * @param {{ group?: unknown }} doc
 * @param {string|null} groupId
 * @returns {boolean}
 */
export function entityInTerritory(doc, groupId) {
  const eg = doc?.group ? String(doc.group) : null;
  const want = groupId ? String(groupId) : null;
  return eg === want;
}

/**
 * @param {{ group?: unknown }} ticket
 * @param {string|null} groupId
 * @returns {boolean}
 */
export function ticketInTerritory(ticket, groupId) {
  return entityInTerritory(ticket, groupId);
}
