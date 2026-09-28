/**
 * @fileoverview Strip password values from free-text prompt sections.
 * Purpose: Memory, day history, and page notes must not carry secrets. The login vault stays separate.
 * Downstream: worker/src/agent.js formatAgentSnapshot and step prompts.
 */

/**
 * Replace password-like values with [REDACTED]. Leaves usernames and the vault block alone.
 * @param {unknown} text
 * @returns {string}
 */
export function redactPromptSecrets(text) {
  let out = String(text ?? "");
  if (!out) return out;
  out = out.replace(
    /\b(passwords?\s*[:=]\s*)([`'"]?)([^\s`'";,]{3,64})\2/gi,
    "$1$2[REDACTED]$2"
  );
  out = out.replace(
    /\b(passwords?\s+(?:is|are|was|were)\s+)([`'"]?)([^\s`'";,]{3,64})\2/gi,
    "$1$2[REDACTED]$2"
  );
  out = out.replace(
    /\b((?:fill(?:ing)?\s+(?:the\s+)?)?passwords?\s+field\s+with\s+)([`'"]?)([^\s`'";,*]{3,64})\2/gi,
    "$1$2[REDACTED]$2"
  );
  return out;
}
