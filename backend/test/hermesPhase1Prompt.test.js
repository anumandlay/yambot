/**
 * @fileoverview Hermes Phase 1 — credential redaction + role-message assembly.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatCredentialsBlock, formatAgentPrompt } from "../src/models/Agent.js";
import {
  assembleAutoLlmMessages,
  formatChatHistoryAsMessages,
  mapChatMessageToLlmRole,
} from "../src/utils/chatContext.js";

describe("formatCredentialsBlock Phase 1", () => {
  const vault = [
    {
      id: "c1",
      label: "Gmail",
      siteHost: "mail.google.com",
      username: "me@x.com",
      email: "me@x.com",
      password: "SuperSecret99!",
      notes: "work",
    },
  ];

  it("redacts passwords by default", () => {
    const block = formatCredentialsBlock(vault);
    assert.match(block, /hasPassword=yes/);
    assert.match(block, /mail\.google\.com/);
    assert.doesNotMatch(block, /SuperSecret99/);
    assert.doesNotMatch(block, /password=SuperSecret/);
  });

  it("can include secrets when opted in (worker-style)", () => {
    const block = formatCredentialsBlock(vault, { includeSecrets: true });
    assert.match(block, /password=SuperSecret99!/);
  });
});

describe("formatAgentPrompt Phase 1", () => {
  it("omits chatContext and passwords from stable system", () => {
    const snap = {
      name: "Tester",
      mode: "browser",
      credentials: [
        {
          label: "Site",
          siteHost: "example.com",
          password: "LeakMeNow",
        },
      ],
      chatContext: "RECENT MESSAGES IN THIS CHAT:\nUSER: hi\nASSISTANT: hello",
      memory: [],
    };
    const prompt = formatAgentPrompt(snap);
    assert.doesNotMatch(prompt, /LeakMeNow/);
    assert.doesNotMatch(prompt, /RECENT MESSAGES/);
    assert.match(prompt, /hasPassword=yes|SAVED LOGINS \(metadata/);
  });
});

describe("assembleAutoLlmMessages", () => {
  it("orders system + history + current user", () => {
    const messages = assembleAutoLlmMessages({
      system: "You are Tester.",
      historyMessages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
      userContent: "USER MESSAGE:\nwhat next?",
    });
    assert.equal(messages[0].role, "system");
    assert.equal(messages[1].role, "user");
    assert.equal(messages[1].content, "hi");
    assert.equal(messages[2].role, "assistant");
    assert.equal(messages.at(-1).role, "user");
    assert.match(messages.at(-1).content, /what next/);
    assert.equal(messages.filter((m) => m.role === "system").length, 1);
  });
});

describe("formatChatHistoryAsMessages", () => {
  it("maps roles and does not invent system dump", () => {
    assert.equal(mapChatMessageToLlmRole({ role: "user" }), "user");
    assert.equal(mapChatMessageToLlmRole({ role: "assistant" }), "assistant");
    assert.equal(mapChatMessageToLlmRole({ role: "agent" }), "assistant");

    const chat = { contextSummary: "", sessionScratch: null };
    const eligible = [
      { _id: "1", role: "user", content: "open yahoo", meta: {} },
      {
        _id: "2",
        role: "assistant",
        content: "Opened yahoo.com",
        meta: { kind: "result" },
      },
    ];
    const msgs = formatChatHistoryAsMessages(chat, eligible, {
      recent: 8,
      lineMax: 400,
      chatChars: 8000,
      summaryMax: 500,
    });
    assert.ok(msgs.length >= 2);
    assert.equal(msgs[0].role, "user");
    assert.equal(msgs[1].role, "assistant");
    assert.ok(!msgs.some((m) => /RECENT MESSAGES IN THIS CHAT/.test(m.content)));
  });
});
