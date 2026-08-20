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
  "finish",
];

export const ACTION_SCHEMA_FOR_PROMPT = `
You control a real Chromium browser (cloud computer for this agent). Reply with ONE JSON object only (no markdown), shape:
{
  "thought": "brief reason",
  "action": {
    "type": "<one of: navigate|click|type|select|press_key|scroll|wait|extract|solve_captcha|ask_user|finish>",
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
- finish: { "type":"finish", "summary":"final answer / result for the user", "success": true }

Rules:
- Prefer refs from the snapshot. Never invent refs.
- For Google research: navigate or use the search box, then open promising links, extract notes, finish with a summary + URLs.
- Do not loop forever. If stuck twice on the same issue, ask_user or finish with what you have.
- Before submitting forms / purchases / applications, prefer ask_user unless autonomy allows submit.
- If a CAPTCHA is visible, use solve_captcha.
`.trim();

/**
 * @param {string} raw
 */
export function parseAgentResponse(raw) {
  const text = String(raw || "").trim();
  let jsonText = text;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) jsonText = fence[1].trim();
  const brace = jsonText.match(/\{[\s\S]*\}/);
  if (brace) jsonText = brace[0];
  const parsed = JSON.parse(jsonText);
  if (!parsed.action || !parsed.action.type) {
    throw new Error("Missing action.type in model response");
  }
  if (!ACTION_TYPES.includes(parsed.action.type)) {
    throw new Error(`Unknown action type: ${parsed.action.type}`);
  }
  return parsed;
}
