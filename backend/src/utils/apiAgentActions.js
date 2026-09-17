/**
 * @fileoverview Action schema for API-only agents (no browser).
 * Purpose: Prompt contract + JSON parse for the in-API agent loop.
 * Downstream: apiAgentRunner.js.
 */

/** Non-browser actions an API agent may emit. */
export const API_ACTION_TYPES = [
  "ask_user",
  "send_email",
  "check_email",
  "search_entities",
  "get_entity",
  "create_entity",
  "update_entity",
  "add_entity_observation",
  "update_kpi",
  "update_ticket",
  "send_slack",
  "send_webhook",
  "create_ticket",
  "search_tickets",
  "crm_sync",
  "send_sms",
  "http_request",
  "message_agent",
  "memory",
  "investigate",
  "finish",
];

/**
 * @returns {string}
 */
export function buildApiActionSchemaForPrompt() {
  return [
    "You are an API-only YamBot agent. You have NO Chromium browser.",
    "Reply with ONE JSON object only (no markdown fences):",
    '{ "thought": "...", "action": { "type": "...", ... } }',
    "Or multiple actions: { \"thought\": \"...\", \"actions\": [ {...}, {...} ] }",
    "",
    "Allowed action.type values:",
    API_ACTION_TYPES.join("|"),
    "",
    "Action fields:",
    '- http_request: { "type":"http_request", "method":"GET|POST|PUT|PATCH|DELETE", "url":"https://...", "headers":{}, "body":"..." }',
    '- message_agent: { "type":"message_agent", "to":"Name"|["B","C"], "content":"...", "wait": true|false|"soft", "soft_wait_minutes": 3 } or fanout:[{to,content}…] — parallel peers (max 5)',
    '- memory: { "type":"memory", "action":"add|replace|remove", "target":"user|memory", "content":"...", "old_text":"..." }',
    '- send_email: { "type":"send_email", "to":"...", "subject":"...", "text":"..." }',
    '- check_email: { "type":"check_email", "limit": 5, "unseen": true }',
    '- search_entities: { "type":"search_entities", "q":"...", "type":"lead|customer|...", "limit": 10 }',
    '- get_entity: { "type":"get_entity", "id":"..." }',
    '- create_entity: { "type":"create_entity", "name":"...", "type":"lead", "status":"new", "attributes":{} }',
    '- update_entity: { "type":"update_entity", "id":"...", "patch":{} }',
    '- add_entity_observation: { "type":"add_entity_observation", "id":"...", "content":"...", "kind":"note" }',
    '- ask_user: { "type":"ask_user", "question":"..." }',
    '- finish: { "type":"finish", "summary":"...", "success": true }',
    '- investigate / update_kpi / tickets / slack / webhook / sms / crm_sync: use fields matching the worker catalog when needed',
    "",
    "Rules: Prefer http_request for external APIs. Never invent browser actions (navigate/click/type).",
    "Use message_agent to collaborate with peers (modes: task|question|approval|handoff|event; max hop depth 2). Prefer wait:false when you have remaining work.",
    "Use memory to save durable user prefs (target user) or agent notes (target memory); hard char caps — replace/remove when full.",
    "Call finish when the goal is done or clearly impossible.",
  ].join("\n");
}

/**
 * @param {string} text
 * @returns {unknown}
 */
function parseJsonLenient(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Empty JSON");
  try {
    return JSON.parse(raw);
  } catch (err) {
    const msg = String(err?.message || err);
    const m = /position\s+(\d+)/i.exec(msg);
    if (m) {
      const pos = Number(m[1]);
      if (Number.isFinite(pos) && pos > 0) {
        const sliced = raw.slice(0, pos).trim();
        if (sliced) return JSON.parse(sliced);
      }
    }
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw err;
  }
}

/**
 * @param {string} raw
 * @returns {{ thought: string, action: object, actions: object[] }}
 */
export function parseApiAgentResponse(raw) {
  let text = String(raw || "");
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  text = text.replace(/```(?:json)?\s*([\s\S]*?)```/i, "$1").trim();
  const parsed = parseJsonLenient(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Model JSON was not an object");
  }
  /** @type {object[]} */
  let list = [];
  if (Array.isArray(parsed.actions) && parsed.actions.length) {
    list = parsed.actions.filter((a) => a && typeof a === "object");
  } else if (parsed.action && typeof parsed.action === "object") {
    list = [parsed.action];
  }
  if (!list.length) throw new Error("Missing action.type in model response");
  for (const act of list) {
    const t = String(act.type || "").trim();
    if (!t) throw new Error("Missing action.type");
    act.type = t;
  }
  return {
    thought: String(parsed.thought || "").trim(),
    action: list[0],
    actions: list,
  };
}
