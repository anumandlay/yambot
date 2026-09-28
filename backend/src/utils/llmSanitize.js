/**
 * @fileoverview Sanitize LLM text before showing it to humans in chat.
 * Purpose: Models often emit internal &lt;think&gt; blocks; those must never appear in the UI.
 * Downstream: chat Q&A, worker task summaries, other assistant Message.create paths.
 */

/**
 * Removes chain-of-thought / thinking wrappers some models leak into the visible reply.
 * Why: Q&A and finish summaries were showing &lt;think&gt;…&lt;/think&gt; in the chat transcript.
 * @param {string} text
 * @returns {string}
 */
export function stripModelThinking(text) {
  let out = String(text || "");
  // Closed blocks (common: <think>…</think>, <thinking>…</thinking>)
  out = out.replace(/<\s*think(?:ing)?\s*>[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/gi, "");
  // Unclosed block at start — drop everything through the first closing-ish boundary or end
  out = out.replace(/^\s*<\s*think(?:ing)?\s*>[\s\S]*?(?=<\s*\/\s*think(?:ing)?\s*>|$)/i, "");
  out = out.replace(/<\s*\/\s*think(?:ing)?\s*>/gi, "");
  // Redacted-style tags some providers use
  out = out.replace(/<\s*redacted_reasoning\s*>[\s\S]*?<\s*\/\s*redacted_reasoning\s*>/gi, "");
  // Why: some models write the date calculation into the answer and end it with “dont show this text”.
  out = out.replace(
    /(?:^|\n+)\s*The user asks\b[\s\S]{0,1200}?\b(?:don'?t|do not|dont) show this text\b\.?\s*/i,
    ""
  );
  return out.replace(/\n{3,}/g, "\n\n").trim();
}
