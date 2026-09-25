/**
 * Smoke: CURRENT DATE/TIME stamp for prompts.
 */
import assert from "node:assert/strict";
import {
  formatCurrentDateTimeForPrompt,
  withCurrentDateTimeInMessages,
} from "../src/utils/promptClock.js";

const line = formatCurrentDateTimeForPrompt(new Date("2026-09-25T19:00:00.000Z"));
assert.match(line, /CURRENT DATE\/TIME:/);
assert.match(line, /2026-09-25T19:00:00\.000Z/);

const msgs = withCurrentDateTimeInMessages([
  { role: "system", content: "You are a helpful agent." },
  { role: "user", content: "hi" },
]);
assert.equal(msgs[0].role, "system");
assert.match(msgs[0].content, /^CURRENT DATE\/TIME:/);
assert.match(msgs[0].content, /You are a helpful agent/);

const again = withCurrentDateTimeInMessages(msgs, new Date("2026-09-25T20:00:00.000Z"));
assert.equal((again[0].content.match(/CURRENT DATE\/TIME:/g) || []).length, 1);
assert.match(again[0].content, /2026-09-25T20:00:00\.000Z/);

console.log("promptClock ok");
