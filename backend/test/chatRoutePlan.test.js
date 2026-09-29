/**
 * The chat router turns one model JSON object into a lane.
 * A follow-up like "delete those" is a reminder stop, not an app name.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  chatRouteContextFromAgent,
  mcpCommandFromRoute,
  normalizeChatRoute,
  redactSecretsForRoute,
  shouldPlanChatRoute,
} from "../src/utils/chatRoutePlan.js";

test("a long computer goal skips the router", () => {
  assert.equal(shouldPlanChatRoute("delete those"), true);
  assert.equal(shouldPlanChatRoute(""), false);
  assert.equal(shouldPlanChatRoute("x".repeat(501)), false);
});

test("bearer tokens are not copied into the router prompt", () => {
  const hidden = redactSecretsForRoute("add mcp https://example.com/mcp bearer SECRETTOKEN");
  assert.equal(hidden.includes("SECRETTOKEN"), false);
  assert.match(hidden, /\[redacted\]/);
});

test("delete those is a reminder stop with an empty hint", () => {
  const route = normalizeChatRoute(
    { lane: "reminder", action: "disable", matchHint: "those" },
    { userText: "delete those" }
  );
  assert.equal(route.lane, "reminder");
  assert.equal(route.reminder.action, "disable");
  assert.equal(route.reminder.matchHint, "");
});

test("a misspelled app is not rewritten onto a saved slug", () => {
  const route = normalizeChatRoute(
    { lane: "composio", action: "reconnect", app: "appollo" },
    { apps: ["apollo", "gmail"], userText: "lets enable appollo" }
  );
  assert.equal(route.lane, "composio");
  assert.equal(route.composio, null);
  assert.equal(route.unmatchedApp, "appollo");
});

test("the model can copy a saved slug", () => {
  const route = normalizeChatRoute(
    { lane: "composio", action: "reconnect", app: "apollo" },
    { apps: ["apollo"], userText: "lets enable apollo" }
  );
  assert.equal(route.composio.action, "reconnect");
  assert.equal(route.composio.slug, "apollo");
});

test("chat and computer do not become an app or a reminder", () => {
  assert.equal(normalizeChatRoute({ lane: "chat" }).lane, "chat");
  assert.equal(normalizeChatRoute({ lane: "reply" }).lane, "chat");
  assert.equal(normalizeChatRoute({ lane: "computer" }).lane, "computer");
  assert.equal(normalizeChatRoute({ lane: "steer" }).lane, "computer");
});

test("mcp add keeps the original sentence and remove uses the server name", () => {
  const original = "connect https://example.com/mcp bearer SECRETTOKEN";
  assert.equal(mcpCommandFromRoute(original, { action: "add" }), original);
  assert.equal(mcpCommandFromRoute(original, { action: "list" }), "list mcp servers");
  assert.equal(mcpCommandFromRoute(original, { action: "remove", server: "mockmcp" }), "remove mcp mockmcp");
});

test("context lists saved apps, servers, and reminders", () => {
  const ctx = chatRouteContextFromAgent({
    agent: {
      composio: { toolkitSlugs: ["apollo"] },
      mcp: { servers: [{ name: "mockmcp" }] },
      schedules: [{ enabled: true, name: "NSE", goal: "open nseindia.com", interval: "5m" }],
    },
    history: [{ role: "assistant", content: "2 reminders" }],
    computerOpen: true,
  });
  assert.deepEqual(ctx.apps, ["apollo"]);
  assert.deepEqual(ctx.servers, ["mockmcp"]);
  assert.equal(ctx.reminders.length, 1);
  assert.match(ctx.reminders[0], /^1\. NSE/);
  assert.equal(ctx.computerOpen, true);
});
