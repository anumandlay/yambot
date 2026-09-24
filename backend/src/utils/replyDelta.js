/**
 * @fileoverview Smooth delta emission for Auto replies that arrive in one shot (tools path).
 * Purpose: After a non-streaming tool loop decides `reply`, chunk the text so the UI still paints progressively.
 * Downstream: chatAutoTurn tools terminal replies.
 */

/**
 * Emit assistant text to an onDelta callback, optionally in small chunks.
 * @param {string} content
 * @param {((chunk: string) => void)|undefined|null} onDelta
 * @param {{ chunk?: boolean, chunkSize?: number }} [opts]
 * @returns {Promise<void>}
 */
export async function emitReplyDelta(content, onDelta, opts = {}) {
  if (typeof onDelta !== "function") return;
  const text = String(content || "");
  if (!text) return;
  if (!opts.chunk) {
    onDelta(text);
    return;
  }
  const size = Math.max(8, Math.min(80, Number(opts.chunkSize) || 28));
  for (let i = 0; i < text.length; i += size) {
    onDelta(text.slice(i, i + size));
    if (i + size < text.length) {
      // Yield so NDJSON flush / event loop can push to the client between chunks.
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}
