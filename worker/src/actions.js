/**
 * @fileoverview Shared agent action schema for the cloud worker.
 * Purpose: Keep LLM action contract aligned with `extension/shared/actions.js`.
 */

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
  "extract",
  "solve_captcha",
  "ask_user",
  "send_email",
  "check_email",
  "finish",
];

export const ACTION_SCHEMA_FOR_PROMPT = `
You control a real Chromium browser (cloud computer for this agent). Reply with ONE JSON object only (no markdown), shape:
{
  "thought": "brief reason",
  "action": {
    "type": "<one of: navigate|click|type|select|press_key|scroll|wait|wait_for|switch_tab|open_tab|upload_file|extract|solve_captcha|ask_user|send_email|check_email|finish>",
    ...fields depending on type
  }
}

Action fields:
- navigate: { "type":"navigate", "url":"https://..." }
- click: { "type":"click", "ref":"e12", "role":"button", "name":"Sign in", "css":"#login", "xpath":"//button[@id='login']" }
- type: { "type":"type", "ref":"e5", "text":"...", "submit": false, "role":"textbox", "name":"Email", "css":"input[name=email]", "xpath":"//input[@name='email']" }
  Also works on contenteditable compose bodies (Gmail message body) — use role textbox, name like "Message body".
- select: { "type":"select", "ref":"e8", "value":"option text or value", "name":"Country", "css":"select#country", "xpath":"//select[@id='country']" }
- press_key: { "type":"press_key", "key":"Enter|Tab|Escape|ArrowDown|..." }
- scroll: { "type":"scroll", "direction":"down|up", "amount": 600 }
- wait: { "type":"wait", "ms": 1500 } — prefer wait_for when you know what should appear
- wait_for: { "type":"wait_for", "role":"dialog", "name":"Payment", "text":"Added to cart", "url_contains":"/checkout", "timeout_ms":10000, "network_idle": false, "dom_stable": true }
  Semantic wait until condition met (role+name, text on page, url_contains, or ref visible). Avoid blind long sleeps.
- switch_tab: { "type":"switch_tab", "index": 1 } or { "type":"switch_tab", "url_contains":"checkout" }
- open_tab: { "type":"open_tab", "url":"https://..." } — optional url
- upload_file: { "type":"upload_file", "ref":"e5", "path":"invoice.pdf" } — path relative to agent uploads folder; use on file inputs
- extract: { "type":"extract", "focus":"what to pull from the page" }
- solve_captcha: { "type":"solve_captcha" }
- ask_user: { "type":"ask_user", "question":"..." }
- send_email: { "type":"send_email", "to":"user@example.com", "subject":"...", "text":"..." }
- check_email: { "type":"check_email", "limit": 8, "unseenOnly": false }
- finish: { "type":"finish", "summary":"final answer / result for the user", "success": true }

Locator rules (click/type/select):
- Prefer "ref" from the latest snapshot (fast path). Never invent refs.
- Each snapshot line may include a stable xpath (id/aria-label based — not DevTools absolute /html/body/div paths). The runtime auto-applies it if the ref goes stale.
- Also pass role+name (or label) and/or cssHint as css when available.
- Without a ref, you MUST supply at least one of: name, label, css, xpath (optionally with role).
- Resolution order: ref → xpath → role+name → label/name → css.
- Custom dropdowns (not native <select>): open the control, then click/select the option by exact name (e.g. name:"Passport", role:"option"). You may use select with value:"Passport".
- Date pickers / calendars: click the day number or quick chip (Today, Tomorrow) by name (e.g. name:"21" or name:"Today"). Do not use type into the date field unless it accepts typed dates.
- Refs in iframes are prefixed frame_N_eM — use as-is; the runtime resolves the frame automatically.
- A viewport screenshot may be attached when verification fails — correlate refs with visible UI.

Rules:
- CRITICAL: Your entire reply must be a single JSON object. No markdown fences, no prose before or after.
- For Google research: navigate or use the search box, then open promising links, extract notes, finish with a summary + URLs.
- Shopping (any store): if the goal mentions cart/basket/bag/trolley, open the header Cart/Basket FIRST (icons often say "items in cart" / "shopping bag"). Do not browse products. Prefer the early snapshot refs for cart/checkout. If missing, navigate on the same host to a common cart path: /cart, /basket, /bag, /gp/cart/view.html, /checkout/cart — pick what matches the site, do not invent a different domain.
- Do not loop forever. If RECENT ACTIONS show LOOP DETECTED or the same action failed twice, change strategy — wait_for, ask_user, or finish.
- Before submitting forms / purchases / applications, prefer ask_user unless autonomy allows submit.
- If a CAPTCHA / robot check / "type the characters" puzzle is visible (Amazon, etc.), call solve_captcha or ask_user immediately. Do NOT re-enter email/password in a loop.
- Image/Amazon captchas cannot be solved automatically — ask_user so the human uses Take control on the live screen.
- When EMAIL IDENTITY is configured, use send_email / check_email for verification codes and human-like mail (do not invent an inbox). Prefer send_email over Gmail web compose when SMTP is set.
`.trim();

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
      if (!parsed.action || !parsed.action.type) {
        lastErr = new Error("Missing action.type in model response");
        continue;
      }
      if (!ACTION_TYPES.includes(parsed.action.type)) {
        lastErr = new Error(`Unknown action type: ${parsed.action.type}`);
        continue;
      }
      return parsed;
    } catch (err) {
      lastErr = err;
    }
  }
  const hint = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 180);
  throw new Error(
    `Could not parse agent JSON (${lastErr?.message || "invalid"}). Preview: ${hint || "(empty)"}`
  );
}
