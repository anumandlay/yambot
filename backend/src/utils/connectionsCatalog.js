/**
 * @fileoverview Integration connection catalog — one-click style setup over Company Memory + agent email.
 * Purpose: Command Center / Connections page knows what is linked without OAuth marketplace.
 * Downstream: GET/PUT /api/connections, ConnectionsPage, CEO missing-dependency hints.
 */

import { CompanyMemory } from "../models/CompanyMemory.js";
import { Agent } from "../models/Agent.js";
import { publicEmailSummary } from "./agentEmail.js";

/** @type {{ id: string, label: string, category: string, keys: string[], help: string, architectHint: string }[]} */
export const CONNECTION_DEFS = [
  {
    id: "gmail",
    label: "Gmail / mailbox",
    category: "communication",
    keys: [],
    help: "Configure SMTP/IMAP on an agent (Gmail app password). Use Sync mailbox on Architect or Agent → Email.",
    architectHint: "Needs a mailbox — open Agents → Email or Architect Sync mailbox.",
  },
  {
    id: "slack",
    label: "Slack",
    category: "communication",
    keys: ["slack_webhook_url"],
    help: "Incoming webhook URL for send_slack actions.",
    architectHint: "Connect Slack webhook in Connections.",
  },
  {
    id: "webhook",
    label: "Generic webhook",
    category: "data",
    keys: ["default_webhook_url"],
    help: "Default outbound webhook for send_webhook.",
    architectHint: "Add default_webhook_url in Connections.",
  },
  {
    id: "hubspot",
    label: "HubSpot CRM",
    category: "crm",
    keys: ["hubspot_api_key", "hubspot_portal_id"],
    help: "Private app token + optional portal id for crm_sync.",
    architectHint: "Connect HubSpot in Connections.",
  },
  {
    id: "salesforce",
    label: "Salesforce",
    category: "crm",
    keys: ["salesforce_instance_url", "salesforce_access_token"],
    help: "Instance URL + access token for crm_sync.",
    architectHint: "Connect Salesforce in Connections.",
  },
  {
    id: "twilio",
    label: "Twilio SMS",
    category: "communication",
    keys: ["twilio_account_sid", "twilio_auth_token", "twilio_from_number"],
    help: "Account SID, auth token, and from number for send_sms.",
    architectHint: "Connect Twilio in Connections.",
  },
  {
    id: "calendar",
    label: "Calendar organizer",
    category: "communication",
    keys: ["calendar_organizer_email"],
    help: "Organizer email for create_calendar_event invites.",
    architectHint: "Set calendar_organizer_email in Connections.",
  },
  {
    id: "sheets",
    label: "Spreadsheets / Sheets",
    category: "data",
    keys: ["google_sheets_webhook_url", "spreadsheet_api_base"],
    help: "Webhook or API base used by agents that update sheets (http_request).",
    architectHint: "Add spreadsheet_api_base or google_sheets_webhook_url.",
  },
];

/**
 * @param {string} userId
 * @returns {Promise<object>}
 */
export async function buildConnectionsStatus(userId) {
  const [rows, agents] = await Promise.all([
    CompanyMemory.find({ user: userId }).select("key value").lean(),
    Agent.find({ user: userId }).select("name email").limit(80).lean(),
  ]);
  const map = Object.fromEntries(
    rows.map((r) => [String(r.key || "").trim(), String(r.value || "").trim()])
  );
  const emailAgents = agents
    .map((a) => {
      const summary = publicEmailSummary(a);
      return {
        _id: String(a._id),
        name: a.name,
        configured: Boolean(summary.configured),
        fromAddress: summary.fromAddress || "",
      };
    })
    .filter((a) => a.configured || a.fromAddress);

  const connections = CONNECTION_DEFS.map((def) => {
    if (def.id === "gmail") {
      const ok = emailAgents.some((a) => a.configured);
      return {
        ...def,
        connected: ok,
        detail: ok
          ? `${emailAgents.filter((a) => a.configured).length} agent mailbox(es)`
          : "No agent has a configured mailbox yet",
        fields: [],
        emailAgents,
      };
    }
    const missing = def.keys.filter((k) => !map[k]);
    return {
      ...def,
      connected: missing.length === 0 && def.keys.length > 0,
      detail:
        def.keys.length === 0
          ? ""
          : missing.length
            ? `Missing: ${missing.join(", ")}`
            : "Connected",
      fields: def.keys.map((k) => ({
        key: k,
        set: Boolean(map[k]),
        masked: map[k] ? (k.includes("token") || k.includes("key") || k.includes("password") ? "••••••••" : map[k].slice(0, 40)) : "",
      })),
    };
  });

  return {
    ok: true,
    connections,
    emailAgents,
    missing: connections.filter((c) => !c.connected).map((c) => c.id),
  };
}

/**
 * Upsert connection keys into company memory.
 * @param {string} userId
 * @param {string} connectionId
 * @param {Record<string, string>} values
 */
export async function upsertConnectionValues(userId, connectionId, values) {
  const def = CONNECTION_DEFS.find((d) => d.id === connectionId);
  if (!def) {
    return { ok: false, title: "Unknown connection", detail: `No connection “${connectionId}”.` };
  }
  if (def.id === "gmail") {
    return {
      ok: false,
      title: "Use agent Email",
      detail: "Gmail is configured per agent (Email section or Architect Sync mailbox).",
      hint: "/agents or /architect",
    };
  }
  const bag = values && typeof values === "object" ? values : {};
  /** @type {object[]} */
  const saved = [];
  for (const key of def.keys) {
    const val = String(bag[key] ?? "").trim();
    if (!val) continue;
    const row = await CompanyMemory.findOneAndUpdate(
      { user: userId, key },
      {
        $set: {
          value: val.slice(0, 4000),
          category: "system",
          source: "connections",
          key,
        },
        $setOnInsert: { user: userId, confidence: 1 },
      },
      { upsert: true, new: true }
    );
    saved.push({ key, id: String(row._id) });
  }
  if (!saved.length) {
    return { ok: false, title: "Nothing saved", detail: "Provide at least one field value." };
  }
  const status = await buildConnectionsStatus(userId);
  return { ok: true, saved, connections: status.connections };
}
