/**
 * Chat sentences that add, list, or reconnect a Composio app before the model runs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyComposioAppFromChat,
  looksLikeComposioAppManageRequest,
  parseComposioAppChat,
} from "../src/utils/composioFromChat.js";

test("app management is not an inbox request", () => {
  assert.equal(looksLikeComposioAppManageRequest("how many composio apps are added?"), true);
  assert.equal(looksLikeComposioAppManageRequest("add composio gmail"), true);
  assert.equal(looksLikeComposioAppManageRequest("yes reauthentiate"), true);
  assert.equal(looksLikeComposioAppManageRequest("reconnect apollo"), true);
  assert.equal(looksLikeComposioAppManageRequest("check my gmail"), false);
  assert.equal(looksLikeComposioAppManageRequest("Use mockmcp. Greet me."), false);
});

test("yes reauthenticate uses the app named in the previous reply", () => {
  const parsed = parseComposioAppChat("yes reauthentiate", [
    { role: "assistant", content: "Apollo needs re-authentication. Want me to reconnect Apollo?" },
  ]);
  assert.equal(parsed.action, "reconnect");
  assert.equal(parsed.slug, "apollo");
});

test("add saves the app and returns the connect link", async () => {
  let saved = false;
  const agent = {
    composio: { enabled: true, toolkitSlugs: ["gmail"], sessionId: "" },
    markModified() {},
    async save() {
      saved = true;
    },
  };
  const applied = await applyComposioAppFromChat({
    agent,
    userId: "user1",
    text: "add composio notion",
    apiKey: "test-key",
    authorize: async () => ({ ok: true, redirectUrl: "https://connect.example/notion", sessionId: "sess1" }),
  });
  assert.equal(applied.ok, true);
  assert.match(applied.content, /Added Notion/);
  assert.match(applied.content, /https:\/\/connect\.example\/notion/);
  assert.equal(saved, true);
  assert.deepEqual(agent.composio.toolkitSlugs, ["gmail", "notion"]);
  assert.equal(applied.content.includes("test-key"), false);
});

test("a list of one expired app waits for yes", async () => {
  const agent = {
    composio: { enabled: true, toolkitSlugs: ["gmail", "apollo"] },
    markModified() {},
    async save() {},
  };
  const applied = await applyComposioAppFromChat({
    agent,
    userId: "user1",
    text: "how many composio apps are added?",
    apiKey: "test-key",
    listStatus: async () => ({
      ok: true,
      connections: [
        { toolkit: "gmail", status: "active", label: "Gmail" },
        { toolkit: "apollo", status: "expired", label: "Apollo" },
      ],
    }),
  });
  assert.match(applied.content, /2 Composio apps/);
  assert.match(applied.content, /Apollo/);
  assert.equal(applied.pending.target.name, "apollo");
  const yes = parseComposioAppChat("yes", [], { pending: applied.pending });
  assert.equal(yes.action, "reconnect");
  assert.equal(yes.slug, "apollo");
});
