/**
 * Unit tests for remember / forget fact extraction and near-dupe replace.
 */
import assert from "node:assert/strict";
import {
  looksLikeMemoryStoreRequest,
  looksLikeMemoryForgetRequest,
  extractRememberFact,
  extractForgetNeedle,
} from "../src/utils/messageIntent.js";
import {
  sanitizeFakeMemoryActionReply,
} from "../src/utils/chatRememberPersist.js";
import {
  addCuratedEntry,
  findNearDuplicateIndex,
  renderCuratedBlock,
  MEMORY_CHAR_LIMIT,
} from "../src/utils/curatedMemory.js";
import { assembleAgentContextBudget } from "../src/utils/memoryContextBudget.js";

assert.equal(looksLikeMemoryStoreRequest("remember i have bmw"), true);
assert.equal(extractRememberFact("remember i have bmw"), "owns a bmw");
assert.equal(
  sanitizeFakeMemoryActionReply(
    'ACTION: memory(action="add", target="user", content="owns a BMW")',
    "Got it — saved."
  ),
  "Got it — saved."
);

assert.equal(looksLikeMemoryForgetRequest("forget that i prefer visible CUA"), true);
assert.equal(looksLikeMemoryStoreRequest("forget that i prefer visible CUA"), false);
assert.equal(looksLikeMemoryForgetRequest("don't forget my email"), false);
assert.ok(extractForgetNeedle("forget that i prefer visible CUA").includes("prefer"));

const near = findNearDuplicateIndex(
  [{ content: "User prefers visible CUA browser automation." }],
  "User prefers visible CUA"
);
assert.equal(near, 0);

const replaced = addCuratedEntry(
  [{ content: "User prefers visible CUA browser automation.", at: new Date() }],
  "User prefers visible browser automation.",
  MEMORY_CHAR_LIMIT,
  { source: "test" }
);
assert.equal(replaced.success, true);
assert.equal(replaced.replaced, true);
assert.equal(replaced.entries.length, 1);
assert.equal(replaced.entries[0], "User prefers visible browser automation.");

const block = renderCuratedBlock("memory", ["note one"]);
assert.match(block, /retrieved notes/i);
assert.match(block, /background information/i);

const budget = assembleAgentContextBudget(128000);
assert.ok(budget.userChars > 0);
assert.ok(budget.memoryChars > budget.userChars);
assert.ok(budget.chatChars > 0);

console.log("chatRememberPersist + memory phase1 ok");
