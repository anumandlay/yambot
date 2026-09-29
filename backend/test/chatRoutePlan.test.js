/**
 * The chat router turns one model JSON object into a lane.
 * A follow-up like "delete those" is a reminder stop, not an app name.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  chatRouteContextFromAgent,
  matchPresentedListPick,
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

test("the model leaves matchHint empty for delete those, and the word is not cleared in code", () => {
  const emptied = normalizeChatRoute(
    { lane: "reminder", action: "disable", matchHint: "" },
    { userText: "delete those" }
  );
  assert.equal(emptied.lane, "reminder");
  assert.equal(emptied.reminder.action, "disable");
  assert.equal(emptied.reminder.matchHint, "");
  const kept = normalizeChatRoute(
    { lane: "reminder", action: "disable", matchHint: "those" },
    { userText: "delete those" }
  );
  assert.equal(kept.reminder.matchHint, "those");
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

test("a copied list name is kept and an unknown name is dropped", () => {
  const items = [
    { type: "mcp_tool", name: "mcp_mockmcp_greetme", label: "Greet the user", id: "" },
    { type: "mcp_tool", name: "mcp_mockmcp_mockmcpstatus", label: "Get the server status", id: "" },
  ];
  assert.equal(matchPresentedListPick("second", items), null);
  assert.equal(matchPresentedListPick("2", items), null);
  const copied = normalizeChatRoute(
    { lane: "chat", listName: "mcp_mockmcp_mockmcpstatus" },
    { listItems: items }
  );
  assert.equal(copied.lane, "list");
  assert.equal(copied.listPick.name, "mcp_mockmcp_mockmcpstatus");
  const unknown = normalizeChatRoute(
    { lane: "chat", listName: "not-a-tool" },
    { listItems: items }
  );
  assert.equal(unknown.lane, "chat");
  assert.equal(unknown.listPick, undefined);
});

test("the model marks yes or no, and another word is not stored as that answer", () => {
  const agreed = normalizeChatRoute({ lane: "chat", reply: "yes" }, {});
  assert.equal(agreed.reply, "yes");
  const refused = normalizeChatRoute({ lane: "composio", action: "cancel", reply: "no" }, {});
  assert.equal(refused.reply, "no");
  const other = normalizeChatRoute({ lane: "chat", reply: "sure" }, {});
  assert.equal(other.reply, undefined);
});

test("chat and computer do not become an app or a reminder", () => {
  assert.equal(normalizeChatRoute({ lane: "chat" }).lane, "chat");
  assert.equal(normalizeChatRoute({ lane: "reply" }).lane, "chat");
  assert.equal(normalizeChatRoute({ lane: "computer" }).computerAction, "start");
  assert.equal(normalizeChatRoute({ lane: "computer", action: "steer" }).computerAction, "steer");
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
