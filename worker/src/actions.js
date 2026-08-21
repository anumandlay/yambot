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
    "type": "<one of: navigate|click|type|select|press_key|scroll|wait|extract|solve_captcha|ask_user|send_email|check_email|finish>",
    ...fields depending on type
  }
}

Action fields:
- navigate: { "type":"navigate", "url":"https://..." }
- click: { "type":"click", "ref":"e12" }
- type: { "type":"type", "ref":"e5", "text":"...", "submit": false }
- select: { "type":"select", "ref":"e8", "value":"option text or value" }
- press_key: { "type":"press_key", "key":"Enter|Tab|Escape|ArrowDown|..." }
- scroll: { "type":"scroll", "direction":"down|up", "amount": 600 }
- wait: { "type":"wait", "ms": 1500 }
- extract: { "type":"extract", "focus":"what to pull from the page" }
- solve_captcha: { "type":"solve_captcha" }
- ask_user: { "type":"ask_user", "question":"..." }
- send_email: { "type":"send_email", "to":"user@example.com", "subject":"...", "text":"..." }
- check_email: { "type":"check_email", "limit": 8, "unseenOnly": false }
- finish: { "type":"finish", "summary":"final answer / result for the user", "success": true }

Rules:
- CRITICAL: Your entire reply must be a single JSON object. No markdown fences, no prose before or after.
- Prefer refs from the snapshot. Never invent refs.
- For Google research: navigate or use the search box, then open promising links, extract notes, finish with a summary + URLs.
- Do not loop forever. If stuck twice on the same issue, ask_user or finish with what you have.
- Before submitting forms / purchases / applications, prefer ask_user unless autonomy allows submit.
- If a CAPTCHA is visible, use solve_captcha.
- When EMAIL IDENTITY is configured, use send_email / check_email for verification codes and human-like mail (do not invent an inbox).
`.trim();

/**
 * Pulls the first balanced `{ ... }` object from mixed model output.
 * Why: models often add prose after JSON; greedy regex includes junk past the real object.
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
 * @param {string} raw
 * @returns {string}
 */
function stripCodeFence(raw) {
  const text = String(raw || "").trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fence ? fence[1].trim() : text;
}

/**
 * @param {string} raw
 */
export function parseAgentResponse(raw) {
  const text = stripCodeFence(raw);
  const candidates = [];
  const balanced = extractFirstJsonObject(text);
  if (balanced) candidates.push(balanced);
  // Why: also try the whole trimmed body in case it is pure JSON.
  if (text && text !== balanced) candidates.push(text.trim());

  let lastErr = null;
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!parsed?.action || !parsed.action.type) {
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
