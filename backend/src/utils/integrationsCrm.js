/**
 * @fileoverview CRM integrations — HubSpot and Salesforce via REST.
 * Purpose: Native-ish CRM sync actions for agents (uses Company Memory + http).
 * Downstream: worker crm_sync action.
 */

import { CompanyMemory } from "../models/CompanyMemory.js";

/**
 * @param {string} userId
 */
export async function loadCrmConfig(userId) {
  const keys = [
    "hubspot_api_key",
    "hubspot_portal_id",
    "salesforce_instance_url",
    "salesforce_access_token",
  ];
  const rows = await CompanyMemory.find({ user: userId, key: { $in: keys } }).lean();
  /** @type {Record<string, string>} */
  const cfg = {};
  for (const r of rows) cfg[r.key] = String(r.value || "").trim();
  return cfg;
}

/**
 * @param {string} userId
 * @param {object} contact - { email, firstname, lastname, company }
 */
export async function hubspotUpsertContact(userId, contact) {
  const cfg = await loadCrmConfig(userId);
  const token = cfg.hubspot_api_key;
  if (!token) return { ok: false, detail: "hubspot_api_key not in Company Memory" };

  const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: {
        email: contact.email,
        firstname: contact.firstname || contact.name?.split(" ")[0] || "",
        lastname: contact.lastname || "",
        company: contact.company || "",
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/**
 * @param {string} userId
 * @param {object} lead - { Email, LastName, Company }
 */
export async function salesforceCreateLead(userId, lead) {
  const cfg = await loadCrmConfig(userId);
  const base = cfg.salesforce_instance_url?.replace(/\/$/, "");
  const token = cfg.salesforce_access_token;
  if (!base || !token) {
    return { ok: false, detail: "salesforce_instance_url and salesforce_access_token required in Company Memory" };
  }

  const res = await fetch(`${base}/services/data/v58.0/sobjects/Lead`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      Email: lead.email || lead.Email,
      LastName: lead.lastname || lead.LastName || "Unknown",
      Company: lead.company || lead.Company || "Unknown",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
