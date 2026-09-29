/**
 * Group-room Composio, MCP, and reminder routing.
 * One named agent runs the action. A bare no follows the latest room reply.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { agentsNamedInRoomText, planRoomAgentManage } from "../src/utils/roomManage.js";

const trial = { _id: "agent-trial", name: "Trial Expiry Checker" };
const general = { _id: "agent-general", name: "General" };
const agents = [trial, general];

test("the router can stop reminders without the word reminder", async () => {
  let seen = null;
  const result = await planRoomAgentManage({
    content: "@General delete those",
    agents,
    userId: "user1",
    history: [{ role: "agent", content: "2 reminders are active." }],
    planRoute: async () => ({
      lane: "reminder",
      reminder: { action: "disable", matchHint: "" },
    }),
    applySchedule: async (opts) => {
      seen = opts;
      return { ok: true, content: "Stopped every reminder." };
    },
  });
  assert.equal(result.kind, "schedule");
  assert.equal(seen.parsed.action, "disable");
  assert.equal(seen.chatId, null);
  assert.match(result.content, /Stopped every reminder/);
});

test("an @mention names one agent, two names do not", () => {
  assert.deepEqual(
    agentsNamedInRoomText("@Trial Expiry Checker list reminders", agents).map((a) => a._id),
    ["agent-trial"]
  );
  assert.equal(agentsNamedInRoomText("@Trial Expiry Checker and @General list reminders", agents).length, 2);
  assert.equal(agentsNamedInRoomText("list reminders", agents).length, 0);
});

test("a named agent lists reminders and the room id is not stored on the job", async () => {
  let seen = null;
  const result = await planRoomAgentManage({
    content: "@Trial Expiry Checker list reminders",
    agents,
    userId: "user1",
    history: [],
    resolveSchedule: async () => ({ action: "list" }),
    applySchedule: async (opts) => {
      seen = opts;
      return { ok: true, content: "Reminders / schedules on this agent:" };
    },
  });
  assert.equal(result.handled, true);
  assert.equal(result.agent._id, "agent-trial");
  assert.equal(result.kind, "schedule");
  assert.equal(seen.chatId, null);
  assert.equal(seen.agent._id, "agent-trial");
});

test("no agent name asks which member should do it", async () => {
  const result = await planRoomAgentManage({
    content: "list reminders",
    agents,
    userId: "user1",
    history: [],
  });
  assert.equal(result.handled, true);
  assert.equal(result.agent, undefined);
  assert.match(result.content, /Which agent/);
  assert.match(result.content, /Trial Expiry Checker/);
});

test("mcp add runs on the named agent", async () => {
  let seen = null;
  const result = await planRoomAgentManage({
    content: "@General add mcp https://example.com/mcp bearer TOKEN",
    agents,
    userId: "user1",
    history: [],
    applyMcp: async (opts) => {
      seen = opts;
      return { ok: true, content: "Added example." };
    },
  });
  assert.equal(result.kind, "mcp");
  assert.equal(seen.agent._id, "agent-general");
  assert.match(seen.text, /https:\/\/example.com\/mcp/);
  assert.equal(result.pending, null);
});

test("composio list stores the agent on the waiting reconnect", async () => {
  const result = await planRoomAgentManage({
    content: "Trial Expiry Checker how many composio apps are added?",
    agents,
    userId: "user1",
    history: [],
    applyComposio: async () => ({
      ok: true,
      content: "Reply yes to reconnect Apollo.",
      pending: {
        expects: "yes_no",
        target: { type: "composio_app", name: "apollo" },
        prompt: "Reconnect Apollo?",
      },
    }),
  });
  assert.equal(result.kind, "composio");
  assert.equal(result.pending.target.id, "agent-trial");
  assert.equal(result.pending.target.name, "apollo");
});

test("no after a reminder does not cancel a leftover reconnect", async () => {
  const result = await planRoomAgentManage({
    content: "no",
    agents,
    userId: "user1",
    state: {
      pending: {
        expects: "yes_no",
        target: { type: "composio_app", name: "apollo", id: "agent-trial" },
        prompt: "Reconnect Apollo?",
      },
    },
    history: [
      { role: "agent", content: "Reply yes to reconnect Apollo." },
      { role: "agent", content: "Want me to re-create the greetme reminder?" },
    ],
  });
  assert.equal(result.handled, false);
  assert.equal(result.clearPending, true);
});

test("no still cancels when the last reply is the reconnect", async () => {
  let seen = null;
  const result = await planRoomAgentManage({
    content: "no",
    agents,
    userId: "user1",
    state: {
      pending: {
        expects: "yes_no",
        target: { type: "composio_app", name: "apollo", id: "agent-trial" },
        prompt: "Reconnect Apollo?",
      },
    },
    history: [{ role: "agent", content: "Reply yes to reconnect Apollo." }],
    applyComposio: async (opts) => {
      seen = opts;
      return { ok: true, content: "Okay, I won't reconnect that app.", pending: null };
    },
  });
  assert.equal(result.handled, true);
  assert.equal(seen.agent._id, "agent-trial");
  assert.equal(seen.parsed.action, "cancel");
  assert.equal(result.pending, null);
});
