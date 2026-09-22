/**
 * @fileoverview Hermes-style Auto: capability questions stay in chat; model decides queue.
 * Run: node --test test/hermesAutoGate.test.js (from backend/)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyMessageIntent } from "../src/utils/messageIntent.js";
import { autoTurnHeuristicGate } from "../src/utils/chatAutoTurn.js";

describe("capability questions vs concrete goals", () => {
  it("treats 'can you open websites' as chat, not forced computer", () => {
    const c = classifyMessageIntent("can you also open webistes for me");
    assert.equal(c.intent, "question");
    assert.equal(c.reason, "capability_question");
    assert.equal(autoTurnHeuristicGate("can you also open webistes for me"), "model");
  });

  it("still queues when a concrete URL/site is named", () => {
    assert.equal(autoTurnHeuristicGate("open https://vughy.com and register"), "queue_goal");
    const c = classifyMessageIntent("can you open gmail.com and check inbox");
    assert.equal(c.intent, "goal");
    assert.equal(autoTurnHeuristicGate("can you open gmail.com and check inbox"), "queue_goal");
  });

  it("lets the model decide action_verbs without a URL (Hermes-style)", () => {
    assert.equal(autoTurnHeuristicGate("log into the admin panel and extract the list"), "model");
  });

  it("still force-queues peer fan-out and send-email", () => {
    assert.equal(
      autoTurnHeuristicGate("ask both researcher and inspector to check the CRM"),
      "queue_goal"
    );
  });
});
