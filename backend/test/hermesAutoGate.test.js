/**
 * @fileoverview Hermes-style Auto: capability questions stay in chat; model decides queue.
 * Also: strip scratchpad before glued REPLY markers so users never see planning notes.
 * Run: node --test test/hermesAutoGate.test.js (from backend/)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyMessageIntent } from "../src/utils/messageIntent.js";
import {
  autoTurnHeuristicGate,
  extractAfterLastReplyMarker,
  parseAutoTurnOutput,
  sanitizeAutoReplyContent,
} from "../src/utils/chatAutoTurn.js";

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

describe("Auto reply scratchpad must not leak", () => {
  const leaked = [
    'We need answer. User asks "can you also open webistes for me" — capability question, no specific site.',
    "Per instructions, reply directly, don't queue. We already answered earlier. Output REPLY with plain sentence.REPLY",
    "Yes, I can open websites for you. Just tell me the website or URL you want opened.",
  ].join("\n");

  it("extracts body after glued …REPLY marker", () => {
    const body = extractAfterLastReplyMarker(leaked);
    assert.ok(body);
    assert.match(body, /^Yes, I can open websites/i);
    assert.equal(/capability question|Per instructions/i.test(body), false);
  });

  it("parseAutoTurnOutput returns only the user sentence", () => {
    const parsed = parseAutoTurnOutput(leaked, "can you also open webistes for me");
    assert.equal(parsed.action, "reply");
    assert.match(parsed.content, /^Yes, I can open websites/i);
    assert.equal(/capability question|We need answer|Output REPLY/i.test(parsed.content), false);
  });

  it("sanitize drops deliberation without a REPLY marker", () => {
    const dump =
      "We need answer. Capability question, no specific site. Per instructions, reply directly, don't queue. We can say yes.";
    const out = sanitizeAutoReplyContent(dump);
    assert.equal(/capability question|We need answer|Per instructions/i.test(out), false);
  });
});
