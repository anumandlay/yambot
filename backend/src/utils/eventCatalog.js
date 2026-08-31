/**
 * @fileoverview Unified business event catalog + type normalization.
 * Purpose: Standardize CompanyEvent types so triggers and workflows match consistently.
 * Downstream: eventBus.emitEvent, triggerEngine, workflows, heal.
 */

/** Canonical event types for Autonomous BOS (P0 catalog). */
export const BUSINESS_EVENT_TYPES = [
  "lead.created",
  "lead.qualified",
  "email.sent",
  "email.received",
  "email.replied",
  "order.created",
  "payment.failed",
  "invoice.overdue",
  "customer.churned",
  "agent.failed",
  "agent.completed",
  "task.completed",
  "task.failed",
  "kpi.dropped",
  "kpi.updated",
  "goal.kpi.gap",
  "goal.kpi.updated",
  "website.changed",
  "watcher.change",
  "api.succeeded",
  "api.failed",
  "workflow.step.completed",
  "workflow.completed",
  "workflow.failed",
  "handoff.sent",
  "handoff.received",
  "ceo.recovery_applied",
  "heal.applied",
  "workforce.delegated",
  "sla.breached",
  "anomaly.detected",
  "system.note",
];

/** Aliases → canonical type. */
const ALIASES = {
  email_replied: "email.replied",
  email_received: "email.received",
  email_sent: "email.sent",
  task_completed: "task.completed",
  task_failed: "task.failed",
  agent_failed: "agent.failed",
  agent_completed: "agent.completed",
  kpi_dropped: "kpi.dropped",
  website_changed: "website.changed",
  "watcher.changed": "watcher.change",
  api_failed: "api.failed",
  api_succeeded: "api.succeeded",
};

/**
 * Normalize an event type string to dotted canonical form.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeEventType(raw) {
  let t = String(raw || "system.note")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(/_/g, ".")
    .replace(/[^a-z0-9.]+/g, "")
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "")
    .slice(0, 80);
  if (!t) t = "system.note";
  if (ALIASES[t]) return ALIASES[t];
  // Collapse double dots from underscore replace on already-dotted types
  const underscored = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (ALIASES[underscored]) return ALIASES[underscored];
  return t;
}

/**
 * @returns {{ schemaVersion: number, types: string[], aliases: object }}
 */
export function getEventCatalog() {
  return {
    schemaVersion: 1,
    types: [...BUSINESS_EVENT_TYPES],
    aliases: { ...ALIASES },
  };
}

/**
 * Mint a correlation id for a workflow/task chain.
 * @param {string} [prefix]
 * @returns {string}
 */
export function mintCorrelationId(prefix = "corr") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
