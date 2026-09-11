/**
 * @fileoverview Shared agent action schema for the cloud worker.
 * Purpose: LLM action contract for the cloud worker agent loop.
 * Downstream: agent.js system prompt + parseAgentResponse for multi-action batches.
 */

import { getMaxActionsPerTurn } from "./fastMode.js";

export const ACTION_TYPES = [
  "navigate",
  "click",
  "type",
  "select",
  "press_key",
  "scroll",
  "wait",
  "wait_for",
  "switch_tab",
  "open_tab",
  "upload_file",
  "fill_form",
  "dismiss_dialog",
  "choose_menu_item",
  "extract",
  "solve_captcha",
  "ask_user",
  "send_email",
  "check_email",
  "search_entities",
  "get_entity",
  "create_entity",
  "update_entity",
  "add_entity_observation",
  "start_process",
  "advance_process",
  "set_entity_status",
  "assign_entity",
  "update_enrollment",
  "update_kpi",
  "update_ticket",
  "send_slack",
  "send_webhook",
  "create_calendar_event",
  "attach_document",
  "search_tickets",
  "create_ticket",
  "search_deals",
  "update_invoice",
  "crm_sync",
  "send_sms",
  "http_request",
  "investigate",
  "request_training",
  "finish",
];

/** Field docs + locator/business rules appended after the batch header. */
const ACTION_FIELDS_AND_RULES = `
"type" for action.type:
"<one of: navigate|click|type|select|press_key|scroll|wait|wait_for|switch_tab|open_tab|upload_file|dismiss_dialog|choose_menu_item|extract|solve_captcha|ask_user|send_email|check_email|search_entities|get_entity|create_entity|update_entity|add_entity_observation|start_process|advance_process|set_entity_status|assign_entity|update_enrollment|update_kpi|update_ticket|send_slack|send_webhook|create_calendar_event|attach_document|search_tickets|create_ticket|search_deals|update_invoice|crm_sync|send_sms|http_request|investigate|request_training|finish>"

Action fields:
- navigate: { "type":"navigate", "url":"https://..." }
- click: { "type":"click", "ref":"e12", "role":"button", "name":"Sign in", "css":"#login", "xpath":"//button[@id='login']" }
- type: { "type":"type", "ref":"e5", "text":"...", "submit": false, "role":"textbox", "name":"Email", "css":"input[name=email]", "xpath":"//input[@name='email']" }
  Instant fill (not keystroke-by-keystroke). Also works on contenteditable compose bodies. For multi-field forms, batch several type actions + one click submit — do not use fill_form.
- select: { "type":"select", "ref":"e8", "value":"option text or value", "name":"Country", "css":"select#country", "xpath":"//select[@id='country']" }
- press_key: { "type":"press_key", "key":"Enter|Tab|Escape|ArrowDown|..." }
- scroll: { "type":"scroll", "direction":"down|up", "amount": 600 } — scrolls the menu/sidebar under the pointer (Vughy nav), not just the whole page; optional ref to scroll a specific panel
- wait: { "type":"wait", "ms": 400 } — rare; prefer acting on the current snapshot
- wait_for: AVOID for "page ready". After navigate we already snapshot at domcontentloaded. Only use wait_for when the CURRENT snapshot already shows a spinner/partial UI and you know an EXACT string/URL/ref that will appear (never invent "Added to cart" / "/checkout" / "Sign in").
  { "type":"wait_for", "text":"exact visible text", "url_contains":"/exact-path", "ref":"e12", "timeout_ms":3000 }
- switch_tab: { "type":"switch_tab", "index": 1 } or { "type":"switch_tab", "url_contains":"checkout" }
- open_tab: { "type":"open_tab", "url":"https://..." } — navigates the same window (no new tabs)
- upload_file: { "type":"upload_file", "ref":"e5", "path":"invoice.pdf" } — path relative to agent uploads folder; use on file inputs
- dismiss_dialog: { "type":"dismiss_dialog" } or { "button":"Cancel" } — closes modal via cancel/close/Escape
- choose_menu_item: { "type":"choose_menu_item", "path": ["File", "Export", "PDF"] } — clicks open menu items in order (menu must already be open)
- extract: { "type":"extract", "focus":"what to pull from the page" }
- solve_captcha: { "type":"solve_captcha" }
- ask_user: { "type":"ask_user", "question":"..." }
- send_email: { "type":"send_email", "to":"user@example.com", "subject":"...", "text":"...", "entityId":"...", "inReplyTo":"...", "references":"..." }
- check_email: { "type":"check_email", "limit": 8, "unseenOnly": false, "entityId":"..." }
- search_entities: { "type":"search_entities", "query":"aanya", "type_filter":"lead", "status":"new", "limit": 10 } — scoped to this agent's territory group; type_filter one of lead|customer|vendor|product|process|document|ticket|custom; optional "kind":"airlines" or "weather"
- get_entity: { "type":"get_entity", "entityId":"..." }
- create_entity: { "type":"create_entity", "name":"...", "type_filter":"lead", "status":"new", "kind":"travel_agency_leads", "attributes": { "email":"...", "phone":"...", "address":"..." } } — or type_filter "custom" + "kind":"weather" + attributes for ad-hoc tables; name is required
- update_entity: { "type":"update_entity", "entityId":"...", "status":"converted", "attributes": { "tier":"gold" } }
- add_entity_observation: { "type":"add_entity_observation", "entityId":"...", "content":"...", "kind":"note" }
- start_process: { "type":"start_process", "definitionId":"...", "entityId":"...", "note":"..." }
- advance_process: { "type":"advance_process", "instanceId":"...", "stage":"qualified", "note":"...", "status":"active|completed" }
- set_entity_status: { "type":"set_entity_status", "entityId":"...", "status":"converted|active|..." }
- assign_entity: { "type":"assign_entity", "entityId":"...", "agentId":"..." }
- update_enrollment: { "type":"update_enrollment", "enrollmentId":"...", "stage":"sent|awaiting_reply|engaged" }
- update_kpi: { "type":"update_kpi", "goalId":"...", "kpiName":"leads_contacted", "delta": 1 }
- update_ticket: { "type":"update_ticket", "ticketId":"...", "status":"in_progress|resolved", "assigneeAgentId":"..." }
- send_slack: { "type":"send_slack", "text":"..." } — uses Company memory key slack_webhook_url
- send_webhook: { "type":"send_webhook", "payload": { "event":"...", "data": {} } }
- create_calendar_event: { "type":"create_calendar_event", "title":"...", "startAt":"ISO", "attendee":"email@..." }
- attach_document: { "type":"attach_document", "filename":"...", "dataBase64":"...", "entityId":"...", "mimeType":"..." }
- search_tickets: { "type":"search_tickets", "query":"login issue", "status":"open", "limit": 10 } — scoped to this agent's territory group
- create_ticket: { "type":"create_ticket", "title":"...", "description":"...", "priority":"high" } — saved into the agent's group ticket DB
- search_deals: { "type":"search_deals", "stage":"proposal" }
- update_invoice: { "type":"update_invoice", "invoiceId":"...", "status":"paid|sent" }
- crm_sync: { "type":"crm_sync", "provider":"hubspot|salesforce", "email":"...", "name":"...", "company":"..." }
- send_sms: { "type":"send_sms", "to":"+1...", "body":"..." }
- http_request: { "type":"http_request", "method":"GET|POST|PUT|PATCH|DELETE", "url":"https://api.example.com/...", "headers":{ "Authorization":"Bearer ..." }, "body":"..." } — server-side HTTP (host must be in Policies httpAllowHosts when configured)
- investigate: { "type":"investigate", "question":"...", "sources":["https://..."], "evidence":[{ "source":"site A", "claim":"...", "confidence":0.8 }] } — multi-source research; pass evidence when synthesizing before finish
- request_training: { "type":"request_training", "workflow":"...", "observation":"what failed", "recommendation":"..." } — file a human training request when stuck on a workflow
- finish: { "type":"finish", "summary":"final answer / result for the user", "success": true }

Locator rules (click/type/select):
- Prefer "ref" from the latest snapshot (fast path). Never invent refs.
- Each snapshot line may include a stable xpath (id/aria-label based — not DevTools absolute /html/body/div paths). The runtime auto-applies it if the ref goes stale.
- Also pass role+name (or label) and/or cssHint as css when available.
- Without a ref, you MUST supply at least one of: name, label, css, xpath (optionally with role).
- Resolution order: ref → xpath → role+name → label/name → css.
- Custom dropdowns (not native <select>): open the control, then click/select the option by exact name (e.g. name:"Passport", role:"option"). You may use select with value:"Passport".
- Date pickers / calendars: click the day number or quick chip (Today, Tomorrow) by name (e.g. name:"21" or name:"Today"). Do not use type into the date field unless it accepts typed dates.
- Prefer a batch of type/click for multi-field forms; dismiss_dialog for cookie/promo modals; choose_menu_item for nested menus.
- Never emit fill_form (removed — use type batches).
- Refs in iframes are prefixed frame_N_eM — use as-is; the runtime resolves the frame automatically.
- A viewport screenshot may be attached when verification fails — correlate refs with visible UI.

Rules:
- CRITICAL: Your entire reply must be a single JSON object. No markdown fences, no prose before or after.
- For web research goals: navigate, open promising links, extract notes, finish with a summary + URLs.
- Shopping (any store): if the goal mentions cart/basket/bag/trolley, open the header Cart/Basket FIRST (icons often say "items in cart" / "shopping bag"). Do not browse products. Prefer the early snapshot refs for cart/checkout. If missing, navigate on the same host to a common cart path: /cart, /basket, /bag, /gp/cart/view.html, /checkout/cart — pick what matches the site, do not invent a different domain.
- Do not loop forever. If RECENT ACTIONS show LOOP DETECTED or the same action failed twice, change strategy — different ref, scroll, ask_user, or finish (do not invent wait_for text).
- PAGE READY: After navigate/open_tab the runtime already waited for domcontentloaded and sent CURRENT PAGE SNAPSHOT. Do not call wait_for just to "let the page load". Act on the snapshot refs you see. If the snapshot is empty/sparse, click/type what is visible or navigate again — do not guess site-specific phrases.
- Before submitting forms / purchases / applications, prefer ask_user unless autonomy allows submit.
- If a CAPTCHA / robot check / "type the characters" puzzle is visible (Amazon, etc.), call solve_captcha or ask_user immediately. Do NOT re-enter email/password in a loop.
- Image/Amazon captchas cannot be solved automatically — ask_user so the human uses Take control on the live screen.
- When EMAIL IDENTITY is configured, use send_email / check_email for verification codes and human-like mail (do not invent an inbox). Prefer send_email over Gmail web compose when SMTP is set.
- COMPANY DATABASE: use search_entities / get_entity to find records in THIS agent's territory group; update_entity and add_entity_observation to persist CRM state; create_entity for new rows (name required; leads default status "new"). Types: lead|customer|vendor|product|process|document|ticket|custom. Use kind for segments (airlines) or custom tables (weather) with fields in attributes. Filter by status "new" for unworked leads. Threaded replies: pass inReplyTo from prior outbound messageId when replying.
- TICKETS & STATE: use update_ticket for support queue; set_entity_status / assign_entity for CRM; update_enrollment after confirmed send_email; update_kpi to record goal progress (or include "KPI: name +1" in finish summary).
`.trim();

/**
 * Builds the system action contract. Max batch size follows YAMBOT_MAX_ACTIONS_PER_TURN / fast mode.
 * @param {number} [maxActions]
 * @returns {string}
 */
export function buildActionSchemaForPrompt(maxActions) {
  const max = Math.max(1, Math.min(16, Number(maxActions) || getMaxActionsPerTurn()));
  const header = `
You control a real Chromium browser (cloud computer for this agent). Reply with ONE JSON object only (no markdown), shape:
{
  "thought": "brief reason",
  "actions": [ { "type":"..." }, { "type":"..." } ]
}

MULTI-ACTION BATCHES (REQUIRED for speed — single-action replies are a last resort):
- Default reply shape is "actions":[…] with as many safe steps as the CURRENT PAGE SNAPSHOT already shows.
- Hard target: pack 4–${max} actions whenever 2+ interactives are needed on this page. One-action turns waste a full LLM round-trip.
- BAD (slow): separate turns for click Search, then type query, then press Enter.
- GOOD (fast): one turn with click + type(submit:true), or type email + type password + click Sign in.
- Scan the ranked interactives / A11Y list and queue every click/type/select you can do BEFORE the page navigates or a modal replaces the DOM.
- Do NOT use fill_form — it often fails (FORM_NOT_FOUND). Use a batch of type + click instead.
- Single-action "action": { ... } or a 1-item "actions" array is ONLY allowed when:
  (1) the next UI is unknown after navigate/submit/open_tab, OR
  (2) finish / ask_user / solve_captcha alone, OR
  (3) only one control is visible and useful.
- If both "action" and "actions" exist, "actions" wins. Hard max ${max} actions per turn.
- Put finish/ask_user/solve_captcha last (or alone). Do not put navigate/open_tab in the middle of a fill burst — they end the batch.
- Gmail / label / filter workflows: batch search box type + Enter, or checkbox + Move-to + label click, in ONE reply when those refs are already on screen.

Example (Google search in ONE turn):
{"thought":"search hello","actions":[
  {"type":"click","ref":"e3","name":"Search"},
  {"type":"type","ref":"e3","text":"hello","submit":true}
]}

Example (login in ONE turn):
{"thought":"sign in","actions":[
  {"type":"type","ref":"e1","text":"user@x.com"},
  {"type":"type","ref":"e2","text":"secret"},
  {"type":"click","ref":"e9","name":"Sign in"}
]}

Example (Gmail move-to-label in ONE turn when refs are visible):
{"thought":"select and label","actions":[
  {"type":"click","ref":"e12","name":"Select"},
  {"type":"click","ref":"e20","name":"Move to"},
  {"type":"click","ref":"e33","name":"Product Hunt"}
]}
`.trim();
  return `${header}\n\n${ACTION_FIELDS_AND_RULES}`;
}

/** Default schema for imports that do not pass a dynamic max (agent prefers buildActionSchemaForPrompt). */
export const ACTION_SCHEMA_FOR_PROMPT = buildActionSchemaForPrompt();

/**
 * Pulls the first balanced `{ ... }` object from mixed model output.
 * @param {string} text
 * @returns {string|null}
 */
export function extractFirstJsonObject(text) {
  const s = String(text || "");
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * JSON.parse that tolerates trailing junk (Node: "after JSON at position N").
 * @param {string} text
 * @returns {unknown}
 */
export function parseJsonLenient(text) {
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
    const balanced = extractFirstJsonObject(raw);
    if (balanced && balanced !== raw) return JSON.parse(balanced);
    throw err;
  }
}

/**
 * @param {string} raw
 * @returns {string}
 */
function preprocessModelText(raw) {
  let text = String(raw || "");
  // Why: some models wrap hidden reasoning that breaks naive parsers.
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  text = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
  text = text.replace(/```(?:json)?\s*([\s\S]*?)```/i, "$1");
  return text.trim();
}

/**
 * @param {string} raw
 */
export function parseAgentResponse(raw) {
  const text = preprocessModelText(raw);
  const candidates = [];
  const balanced = extractFirstJsonObject(text);
  if (balanced) candidates.push(balanced);
  if (text && text !== balanced) candidates.push(text);

  let lastErr = null;
  for (const candidate of candidates) {
    try {
      const parsed = parseJsonLenient(candidate);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        lastErr = new Error("Model JSON was not an object");
        continue;
      }
      const list = normalizeActionList(parsed);
      if (!list.length) {
        lastErr = new Error("Missing action.type in model response");
        continue;
      }
      for (const act of list) {
        if (!ACTION_TYPES.includes(act.type)) {
          lastErr = new Error(`Unknown action type: ${act.type}`);
          throw lastErr;
        }
      }
      return {
        thought: String(parsed.thought || "").trim(),
        action: list[0],
        actions: list,
      };
    } catch (err) {
      lastErr = err;
    }
  }
  const hint = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 180);
  throw new Error(
    `Could not parse agent JSON (${lastErr?.message || "invalid"}). Preview: ${hint || "(empty)"}`
  );
}

/**
 * Expands deprecated fill_form into type (+ optional submit click) so we never hit FORM_NOT_FOUND.
 * @param {object} action
 * @returns {object[]}
 */
function expandFillFormAction(action) {
  const fields = action?.fields && typeof action.fields === "object" ? action.fields : {};
  /** @type {object[]} */
  const out = [];
  for (const [name, text] of Object.entries(fields)) {
    out.push({
      type: "type",
      name: String(name),
      text: String(text ?? ""),
      submit: false,
    });
  }
  if (action?.submit) {
    out.push({
      type: "click",
      name: String(action.submit_name || action.submitName || "Sign in"),
    });
  }
  return out.length ? out : [{ type: "wait", ms: 100 }];
}

/**
 * Accepts single `action` or batched `actions` from the model.
 * @param {object} parsed
 * @returns {object[]}
 */
export function normalizeActionList(parsed) {
  const max = getMaxActionsPerTurn();
  /** @type {object[]} */
  let raw = [];
  if (Array.isArray(parsed?.actions) && parsed.actions.length) {
    raw = parsed.actions.filter((a) => a && typeof a === "object" && a.type);
  } else if (parsed?.action && typeof parsed.action === "object" && parsed.action.type) {
    raw = [parsed.action];
  }
  /** @type {object[]} */
  const expanded = [];
  for (const act of raw) {
    if (act.type === "fill_form") {
      // Why: fill_form often fails with FORM_NOT_FOUND on SPAs; rewrite to type/click batch.
      expanded.push(...expandFillFormAction(act));
    } else {
      expanded.push(act);
    }
  }
  return expanded.slice(0, max);
}

/** Actions that should end a multi-action batch (re-observe / wait for human). */
export const BATCH_STOP_TYPES = new Set([
  "finish",
  "ask_user",
  "solve_captcha",
  "navigate",
  "open_tab",
  "wait_for",
]);

/** Light settle types — short pause, no full DOM wait every field. */
export const LIGHT_SETTLE_TYPES = new Set([
  "type",
  "fill_form",
  "select",
  "press_key",
  "scroll",
  "wait",
]);
