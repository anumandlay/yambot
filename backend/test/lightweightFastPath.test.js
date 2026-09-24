/**
 * Unit tests — Hermes-style lightweight Auto fast path.
 */
import assert from "node:assert/strict";
import {
  looksLikeLightweightChat,
  createAutoTimingTracker,
} from "../src/utils/chatAutoTurn.js";

assert.equal(looksLikeLightweightChat("how are you"), true);
assert.equal(looksLikeLightweightChat("How are you?"), true);
assert.equal(looksLikeLightweightChat("what's up"), true);
assert.equal(looksLikeLightweightChat("nice weather today"), true);
assert.equal(looksLikeLightweightChat("check my gmail inbox"), false);
assert.equal(looksLikeLightweightChat("open google.com and search cats"), false);
assert.equal(looksLikeLightweightChat("send email to bob@x.com"), false);
assert.equal(looksLikeLightweightChat("remember I like dark mode"), false);

const track = createAutoTimingTracker();
await new Promise((r) => setTimeout(r, 15));
track.markPrepDone();
await new Promise((r) => setTimeout(r, 20));
track.markFirstToken();
const fin = track.finish({ path: "text_fast" });
assert.ok(fin.prepMs != null && fin.prepMs >= 10, `prepMs=${fin.prepMs}`);
assert.ok(fin.firstTokenMs > fin.prepMs, `first=${fin.firstTokenMs} prep=${fin.prepMs}`);
assert.equal(fin.path, "text_fast");

console.log("lightweight fast path ok", {
  prepMs: fin.prepMs,
  firstTokenMs: fin.firstTokenMs,
});
