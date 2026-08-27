/**
 * @fileoverview Outcome branch normalization — LLM result routing config shared by goals and triggers.
 * Purpose: Validate branch list before save and before emitting routed events after task completion.
 * Downstream: Goal/Trigger models, resultRouter.js, goals/triggers API routes.
 */

import { normalizeGoalEventType } from "../models/Goal.js";

/**
 * @typedef {{ label: string, eventType: string, description: string }} OutcomeBranch
 */

/**
 * Normalizes outcome branch rows from API/UI payloads.
 * @param {unknown} raw
 * @returns {OutcomeBranch[]}
 */
export function normalizeOutcomeBranches(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {OutcomeBranch[]} */
  const out = [];
  for (const row of raw.slice(0, 12)) {
    if (!row || typeof row !== "object") continue;
    const eventType = normalizeGoalEventType(row.eventType);
    if (!eventType) continue;
    const label = String(row.label || row.eventType || "").trim().slice(0, 80);
    const description = String(row.description || "").trim().slice(0, 500);
    out.push({
      label: label || eventType,
      eventType,
      description,
    });
  }
  return out;
}

/**
 * @param {OutcomeBranch[]} branches
 * @returns {Set<string>}
 */
export function outcomeBranchEventTypes(branches) {
  return new Set((branches || []).map((b) => b.eventType).filter(Boolean));
}
