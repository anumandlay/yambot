/**
 * @fileoverview Per-chat Auto turn serialization.
 * Purpose: Prevent overlapping Auto/Answer LLM turns on the same chat from racing history writes.
 * Why: Hermes-style session lock — independent chats still run concurrently.
 * Downstream: chats.js Auto + Answer paths.
 */

/** @type {Map<string, Promise<void>>} */
const chatTails = new Map();

/**
 * Run `fn` after any prior Auto turn for this chat finishes.
 * @template T
 * @param {string|null|undefined} chatId
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withChatAutoLock(chatId, fn) {
  const key = String(chatId || "").trim() || "_anon";
  const prev = chatTails.get(key) || Promise.resolve();

  /** @type {() => void} */
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  // Why: next waiter chains onto this turn’s gate, not onto fn’s result (fn errors must not poison the queue).
  const nextTail = prev.then(
    () => gate,
    () => gate
  );
  chatTails.set(key, nextTail);

  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    // Why: drop the map entry when this is still the latest chain tip.
    if (chatTails.get(key) === nextTail) {
      void nextTail.then(() => {
        if (chatTails.get(key) === nextTail) chatTails.delete(key);
      });
    }
  }
}

/**
 * Test helper — clear in-memory locks.
 */
export function resetChatAutoLocksForTests() {
  chatTails.clear();
}
