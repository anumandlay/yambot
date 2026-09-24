/**
 * Unit tests for Latency Phase 2 — chat Auto lock + reply delta chunking.
 */
import assert from "node:assert/strict";
import { withChatAutoLock, resetChatAutoLocksForTests } from "../src/utils/chatAutoLock.js";
import { emitReplyDelta } from "../src/utils/replyDelta.js";

resetChatAutoLocksForTests();

const order = [];
const p1 = withChatAutoLock("chat-a", async () => {
  order.push("a-start");
  await new Promise((r) => setTimeout(r, 40));
  order.push("a-end");
  return 1;
});
const p2 = withChatAutoLock("chat-a", async () => {
  order.push("b-start");
  order.push("b-end");
  return 2;
});
const p3 = withChatAutoLock("chat-b", async () => {
  order.push("c");
  return 3;
});

const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
assert.equal(r1, 1);
assert.equal(r2, 2);
assert.equal(r3, 3);
assert.deepEqual(order.slice(0, 2).sort(), ["a-start", "c"].sort());
assert.ok(order.indexOf("a-end") < order.indexOf("b-start"));

const chunks = [];
await emitReplyDelta("Hello world from YamBot", (c) => chunks.push(c), {
  chunk: true,
  chunkSize: 8,
});
assert.ok(chunks.length > 1);
assert.equal(chunks.join(""), "Hello world from YamBot");

await emitReplyDelta("one", (c) => chunks.push(c), { chunk: false });
assert.equal(chunks[chunks.length - 1], "one");

console.log("latency phase2 ok");
