/**
 * Unit tests — Hermes-style tool decision (answer-direct by default).
 */
import assert from "node:assert/strict";
import {
  autoTurnNeedsTools,
  looksLikeLightweightChat,
  createAutoTimingTracker,
} from "../src/utils/chatAutoTurn.js";

// Answer-direct (no tools) — Hermes under-2s path
assert.equal(autoTurnNeedsTools("how are you"), false);
assert.equal(autoTurnNeedsTools("what is a TTL cache?"), false);
assert.equal(autoTurnNeedsTools("explain your reply flow briefly"), false);
assert.equal(autoTurnNeedsTools("nice weather today"), false);

// Tools needed
assert.equal(autoTurnNeedsTools("check my gmail inbox"), true);
assert.equal(autoTurnNeedsTools("check email"), true);
assert.equal(autoTurnNeedsTools("open google.com and search cats"), true);
assert.equal(autoTurnNeedsTools("are you still running a task?"), true);
assert.equal(autoTurnNeedsTools("list my peer agents"), true);
assert.equal(
  autoTurnNeedsTools("list my connected apps", { composioEnabled: true }),
  true
);
assert.equal(
  autoTurnNeedsTools("list my connected apps", { composioEnabled: false }),
  false
);

assert.equal(looksLikeLightweightChat("how are you"), true);
assert.equal(looksLikeLightweightChat("check my gmail"), false);

const track = createAutoTimingTracker();
track.setPath("text_fast");
track.markDecision("reply");
const fin = track.finish();
assert.equal(fin.path, "text_fast");
assert.equal(fin.decisionAction, "reply");

console.log("hermes tool decision ok");
