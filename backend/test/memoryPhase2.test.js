/**
 * Unit tests for Memory Phase 2 — session scratch, tool compression, untrusted merge.
 */
import assert from "node:assert/strict";
import {
  looksLikeSessionScratchRequest,
  extractSessionScratchFact,
  looksLikeMemoryStoreRequest,
} from "../src/utils/messageIntent.js";
import {
  addScratchNote,
  formatSessionScratchBlock,
  normalizeScratchNotes,
} from "../src/utils/sessionScratch.js";
import { compressToolResultForContext } from "../src/utils/chatContext.js";
import { mergeMem0IntoCurated } from "../src/utils/mem0Service.js";

assert.equal(
  looksLikeSessionScratchRequest("for this chat remember the CRM password is temporary"),
  true
);
assert.equal(
  looksLikeMemoryStoreRequest("for this chat remember the CRM password is temporary"),
  false
);
assert.ok(
  extractSessionScratchFact("for this chat remember the draft subject is Hello").includes(
    "draft subject"
  )
);

const { notes, added } = addScratchNote(null, "use visible browser for this chat", {
  source: "test",
});
assert.equal(added, true);
assert.equal(notes.length, 1);
const block = formatSessionScratchBlock({ notes });
assert.match(block, /SESSION SCRATCH/i);
assert.match(block, /temporary/i);

const expired = normalizeScratchNotes([
  {
    content: "gone",
    at: new Date(Date.now() - 48 * 3600_000),
    expiresAt: new Date(Date.now() - 1000),
  },
]);
assert.equal(expired.length, 0);

const compressed = compressToolResultForContext(
  "<html><body>" + "x".repeat(2000) + "</body></html>",
  { meta: { kind: "observe" } }
);
assert.ok(compressed.length < 500);
assert.match(compressed, /compressed/i);

const merged = mergeMem0IntoCurated(
  ["trusted mongo fact about BMW"],
  [{ memory: "mem0 fact about slack", score: 0.9 }],
  2000
);
assert.equal(merged.mem0Added, 1);
assert.ok(merged.contents.some((c) => c.startsWith("[untrusted·retrieved]")));
assert.ok(merged.contents.some((c) => c === "trusted mongo fact about BMW"));
assert.equal(merged.untrusted.length, 1);
assert.equal(merged.trusted.length, 1);

console.log("memory phase2 ok");
