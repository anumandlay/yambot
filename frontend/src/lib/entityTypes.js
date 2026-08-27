/**
 * @fileoverview Entity type catalog — mirrors backend ENTITY_TYPES with UI labels.
 * Purpose: Keep Company filters/forms and help copy aligned with Mongo Entity.type enum.
 * Downstream: CompanyPage, helpContent (docs), any entity pickers.
 */

/** @typedef {{ value: string, label: string, blurb: string }} EntityTypeOption */

/**
 * Fixed CRM / world-model types (must match backend `ENTITY_TYPES`).
 * Use `kind` for user-invented segments/tables inside a type.
 * @type {readonly EntityTypeOption[]}
 */
export const ENTITY_TYPE_OPTIONS = Object.freeze([
  {
    value: "lead",
    label: "Lead",
    blurb: "Prospect not sold yet (agencies, corporates, airlines). Default status new.",
  },
  {
    value: "customer",
    label: "Customer",
    blurb: "Won / paying account after conversion.",
  },
  {
    value: "vendor",
    label: "Vendor",
    blurb: "Supplier you buy from (hotels, GDS, tools).",
  },
  {
    value: "product",
    label: "Product",
    blurb: "Thing you sell (plan, package, add-on).",
  },
  {
    value: "process",
    label: "Process",
    blurb: "Workflow-linked object; prefer Company → Processes for playbooks.",
  },
  {
    value: "document",
    label: "Document",
    blurb: "Contract/file-style record; Queues also has file uploads.",
  },
  {
    value: "ticket",
    label: "Ticket",
    blurb: "Support case as an entity; prefer Queues → Tickets for email intake.",
  },
  {
    value: "custom",
    label: "Custom",
    blurb: "Invented datasets — always set kind (e.g. weather) + fields in attributes.",
  },
]);

/** @type {readonly string[]} */
export const ENTITY_TYPES = ENTITY_TYPE_OPTIONS.map((o) => o.value);

/**
 * @param {string} value
 * @returns {string}
 */
export function entityTypeLabel(value) {
  const hit = ENTITY_TYPE_OPTIONS.find((o) => o.value === value);
  return hit ? hit.label : String(value || "");
}
