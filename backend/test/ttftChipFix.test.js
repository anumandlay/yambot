/**
 * Unit tests — TTFT chip must record firstTokenMs even when REPLY protocol holds the bubble.
 */
import assert from "node:assert/strict";
import { createAutoTimingTracker } from "../src/utils/chatAutoTurn.js";
import { emitReplyDelta } from "../src/utils/replyDelta.js";

const track = createAutoTimingTracker();
assert.equal(track.hasFirstToken(), false);

await new Promise((r) => setTimeout(r, 25));
// Simulate first SSE token while visible buffer is still empty (protocol hold).
track.markFirstToken();
assert.equal(track.hasFirstToken(), true);

const early = track.finish().firstTokenMs;
assert.ok(early != null && early >= 20, `early firstTokenMs=${early}`);

// Continue on a fresh tracker for total > first flow.
const track2 = createAutoTimingTracker();
await new Promise((r) => setTimeout(r, 20));
track2.markFirstToken();
const first = /** @type {number} */ (track2.finish().firstTokenMs);
await new Promise((r) => setTimeout(r, 35));
const chunks = [];
const delta = track2.wrapOnDelta((c) => chunks.push(c));
await emitReplyDelta("Bye now. Have a great day ahead.", delta, {
  chunk: true,
  chunkSize: 12,
});
assert.ok(chunks.length > 1);
const timing = track2.finish({ path: "text_fallback" });
assert.equal(timing.firstTokenMs, first);
assert.ok(
  timing.totalMs > timing.firstTokenMs,
  `totalMs=${timing.totalMs} firstTokenMs=${timing.firstTokenMs}`
);

// Idempotent: second markFirstToken must not move the stamp.
const track3 = createAutoTimingTracker();
track3.markFirstToken();
const t1 = track3.finish().firstTokenMs;
await new Promise((r) => setTimeout(r, 20));
track3.markFirstToken();
assert.equal(track3.finish().firstTokenMs, t1);

// Chip label format (mirrors MessageStatusChips).
const ttft = Number(timing.firstTokenMs);
const ms = Number(timing.totalMs);
const ttftLabel =
  ttft >= 1000 ? `TTFT ${(ttft / 1000).toFixed(2)}s` : `TTFT ${ttft}ms`;
const sec = ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
const label = [ttftLabel, sec].join(" · ");
assert.match(label, /TTFT/i);
assert.ok(!label.startsWith(" · "), "TTFT must not be blank");

console.log("ttft chip fix ok", label);
