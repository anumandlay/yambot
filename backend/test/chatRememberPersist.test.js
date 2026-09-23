/**
 * Unit tests for remember-fact extraction / detection.
 */
import assert from "node:assert/strict";
import {
  looksLikeMemoryStoreRequest,
  extractRememberFact,
} from "../src/utils/messageIntent.js";
import { sanitizeFakeMemoryActionReply } from "../src/utils/chatRememberPersist.js";

assert.equal(looksLikeMemoryStoreRequest("remember i have bmw"), true);
assert.equal(extractRememberFact("remember i have bmw"), "owns a bmw");
assert.equal(
  sanitizeFakeMemoryActionReply(
    'ACTION: memory(action="add", target="user", content="owns a BMW")',
    "Got it — saved."
  ),
  "Got it — saved."
);
console.log("chatRememberPersist ok");
