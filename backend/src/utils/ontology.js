/**
 * @fileoverview Business ontology — canonical entity types and relationships.
 * Purpose: Shared language for CEO, Architect, agents, triggers, KPIs, memory.
 * Downstream: Entity model, entityContext, workflows, pulse.
 */

/** Ontology entity types (maps onto Entity.type + aliases). */
export const ONTOLOGY_TYPES = [
  "customer",
  "lead",
  "contact",
  "opportunity",
  "order",
  "invoice",
  "product",
  "campaign",
  "employee",
  "supplier",
  "ticket",
  "document",
];

/** Allowed relationship kinds between entities. */
export const ONTOLOGY_RELS = [
  "converted_from",
  "belongs_to",
  "works_at",
  "owns",
  "ordered",
  "invoiced_for",
  "sold_as",
  "enrolled_in",
  "assigned_to",
  "supplies",
  "related_to",
];

/**
 * Map Entity.type / kind aliases onto ontology labels.
 * @param {string} type
 * @param {string} [kind]
 * @returns {string}
 */
export function toOntologyType(type, kind = "") {
  const t = String(type || "").toLowerCase();
  const k = String(kind || "").toLowerCase();
  if (t === "vendor") return "supplier";
  if (t === "custom" && k === "opportunity") return "opportunity";
  if (t === "custom" && k === "contact") return "contact";
  if (t === "custom" && k === "order") return "order";
  if (ONTOLOGY_TYPES.includes(t)) return t;
  if (t === "process") return "document";
  return t || "customer";
}

/**
 * Public ontology descriptor for APIs / LLM prompts.
 * @returns {object}
 */
export function getOntologyDescriptor() {
  return {
    schemaVersion: 1,
    types: ONTOLOGY_TYPES.map((id) => ({
      id,
      label: id.charAt(0).toUpperCase() + id.slice(1),
    })),
    relationships: ONTOLOGY_RELS,
    notes:
      "Use Entity.type for core CRM types; use kind for opportunity/contact/order when type=custom. Prefer links[] for relationships.",
  };
}

/**
 * Compact prompt block for CEO / Architect.
 * @returns {string}
 */
export function formatOntologyForPrompt() {
  return [
    "ONTOLOGY TYPES: " + ONTOLOGY_TYPES.join(", "),
    "RELATIONSHIPS: " + ONTOLOGY_RELS.join(", "),
    "Always reference entityId + entityType in events and handoffs when known.",
  ].join("\n");
}
