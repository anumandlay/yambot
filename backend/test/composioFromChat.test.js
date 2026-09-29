/**
 * Chat sentences that add, list, or reconnect a Composio app before the model runs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptComposioKeywordPlan,
  applyComposioAppFromChat,
  looksLikeComposioAppManageRequest,
  normalizeComposioManagePlan,
  parseComposioAppChat,
} from "../src/utils/composioFromChat.js";

test("app management is not an inbox request", () => {
  assert.equal(looksLikeComposioAppManageRequest("how many composio apps are added?"), true);
  assert.equal(looksLikeComposioAppManageRequest("add composio gmail"), true);
  assert.equal(looksLikeComposioAppManageRequest("yes reauthentiate"), true);
  assert.equal(looksLikeComposioAppManageRequest("re authenticate"), true);
  assert.equal(looksLikeComposioAppManageRequest("reconnect apollo"), true);
  assert.equal(looksLikeComposioAppManageRequest("check my gmail"), false);
  assert.equal(looksLikeComposioAppManageRequest("Use mockmcp. Greet me."), false);
  assert.equal(looksLikeComposioAppManageRequest("delete those"), false);
});

test("re authenticate with a space still reconnects the waiting app", () => {
  const pending = {
    kind: "confirm",
    expects: "yes_no",
    target: { type: "composio_app", name: "apollo" },
  };
  assert.equal(looksLikeComposioAppManageRequest("re authenticate", { pending }), true);
  const parsed = parseComposioAppChat("re authenticate", [], { pending });
  assert.equal(parsed.action, "reconnect");
  assert.equal(parsed.slug, "apollo");
});

test("a misspelling is not saved and is not rewritten in code", async () => {
  const apps = ["gmail", "apollo"];
  assert.equal(acceptComposioKeywordPlan("lets enable appollo", null, apps), null);
  assert.equal(normalizeComposioManagePlan({ action: "reconnect", app: "appollo" }, null, apps), null);
  const chosen = normalizeComposioManagePlan({ action: "reconnect", app: "apollo" }, null, apps);
  assert.equal(chosen.slug, "apollo");
  let saved = false;
  const agent = {
    composio: { enabled: true, toolkitSlugs: ["gmail", "apollo", "appollo"], sessionId: "" },
    markModified() {},
    async save() {
      saved = true;
    },
  };
  let calls = 0;
  const applied = await applyComposioAppFromChat({
    agent,
    userId: "user1",
    text: "reconnect apollo",
    apiKey: "test-key",
    parsed: chosen,
    authorize: async (opts) => {
      calls += 1;
      if (opts.toolkitSlugs.includes("appollo")) {
        return { ok: false, error: '400 {"error":{"message":"Invalid toolkit slugs: appollo. Please provide valid toolkit slugs."}}' };
      }
      return { ok: true, redirectUrl: "https://connect.example/apollo", sessionId: "sess1" };
    },
  });
  assert.equal(applied.ok, true);
  assert.match(applied.content, /Reconnect Apollo/);
  assert.equal(calls, 2);
  assert.equal(saved, true);
  assert.equal(agent.composio.toolkitSlugs.includes("appollo"), false);
  assert.equal(agent.composio.toolkitSlugs.includes("apollo"), true);
});

test("the model can activate the waiting app without those words", () => {
  const state = { pending: { target: { type: "composio_app", name: "apollo" } } };
  assert.equal(looksLikeComposioAppManageRequest("i want to activate the app"), false);
  const plan = normalizeComposioManagePlan({ action: "activate", app: "" }, state);
  assert.equal(plan.action, "reconnect");
  assert.equal(plan.slug, "apollo");
  assert.equal(normalizeComposioManagePlan({ action: "none" }, state), null);
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

test("no after a reminder does not cancel a leftover composio reconnect", () => {
  const pending = {
    expects: "yes_no",
    target: { type: "composio_app", name: "apollo" },
    prompt: "Reconnect Apollo?",
  };
  const reminder = [
    { role: "assistant", content: "Reply yes to reconnect Apollo." },
    { role: "assistant", content: "Want me to re-create the every-1-minute greetme one now?" },
  ];
  assert.equal(looksLikeComposioAppManageRequest("no", { pending }, reminder), false);
  assert.equal(acceptComposioKeywordPlan("no", { pending }, ["apollo"], reminder), null);
  assert.equal(acceptComposioKeywordPlan("yes", { pending }, ["apollo"], reminder), null);
  const stillOpen = [{ role: "assistant", content: "Reply yes to reconnect Apollo." }];
  assert.equal(looksLikeComposioAppManageRequest("no", { pending }, stillOpen), true);
  assert.equal(parseComposioAppChat("no", stillOpen, { pending }).action, "cancel");
});
