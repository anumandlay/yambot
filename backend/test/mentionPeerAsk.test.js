/**
 * @fileoverview Natural-language peer ask (“tell General agent to …”) without @.
 * Run: node --test test/mentionPeerAsk.test.js (from backend/)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseNaturalPeerAsk,
  resolvePeerAskAssignments,
} from "../src/utils/mentionAgent.js";
import { defaultQueueAck } from "../src/utils/chatAutoTurn.js";

const agents = [
  { _id: "india1", name: "Trial Expiry Checker vughy India" },
  { _id: "gen1", name: "General agent" },
];

describe("natural peer ask", () => {
  it("parses tell General agent to open …", () => {
    const hits = parseNaturalPeerAsk(
      "tell general agent to open vughy.com",
      agents,
      "india1"
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0].agentId, "gen1");
    assert.match(hits[0].content, /vughy\.com/i);
  });

  it("resolvePeerAskAssignments prefers @ over natural", () => {
    const hits = resolvePeerAskAssignments(
      "@General agent open https://example.com",
      agents,
      "india1"
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0].agentId, "gen1");
  });

  it("defaultQueueAck for peer tell is not Starting computer", () => {
    const ack = defaultQueueAck("tell general agent to open vughy.com", "Trial India");
    assert.match(ack, /peer/i);
    assert.equal(/Starting Trial India/i.test(ack), false);
  });
});
