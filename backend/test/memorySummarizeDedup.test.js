/**
 * Smoke: episodic note near-dupe key helpers used by appendAgentMemory / day log skip.
 */
import assert from "node:assert/strict";
import { normalizeFactKey, findNearDuplicateIndex } from "../src/utils/curatedMemory.js";

const a = "India trial expiry list: 12 accounts, 3 expiring this week";
const b = "india trial expiry list 12 accounts 3 expiring this week";
assert.equal(normalizeFactKey(a), normalizeFactKey(b));

const list = [{ content: a }, { content: "prefer visible browser" }];
assert.equal(findNearDuplicateIndex(list, b), 0);
assert.equal(findNearDuplicateIndex(list, "totally different fact about slack"), -1);

console.log("memorySummarizeDedup ok");
