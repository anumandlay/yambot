/**
 * Chat sentences that add or remove an MCP server, before the model runs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyMcpServerFromChat,
  looksLikeMcpServerManageRequest,
  parseMcpServerChat,
} from "../src/utils/mcpFromChat.js";

test("add and list phrases are server management, tool use is not", () => {
  assert.equal(looksLikeMcpServerManageRequest("add mcp https://app.mockmcp.com/servers/abc/mcp bearer tokenvalue"), true);
  assert.equal(looksLikeMcpServerManageRequest("list mcp servers"), true);
  assert.equal(looksLikeMcpServerManageRequest("remove mcp mockmcp"), true);
  assert.equal(looksLikeMcpServerManageRequest("list of mcps"), false);
  assert.equal(looksLikeMcpServerManageRequest("Use mockmcp. Greet me."), false);
});

test("parse pulls the URL and bearer token and ignores ordinary words", () => {
  const parsed = parseMcpServerChat(
    "add mcp https://app.mockmcp.com/servers/abc/mcp bearer mcp_m2m_exampletoken named desk"
  );
  assert.equal(parsed.action, "add");
  assert.equal(parsed.url, "https://app.mockmcp.com/servers/abc/mcp");
  assert.equal(parsed.token, "Bearer mcp_m2m_exampletoken");
  assert.equal(parsed.name, "desk");
  assert.equal(parseMcpServerChat("add mcp").action, "help");
  assert.equal(parseMcpServerChat("remove mcp mockmcp").name, "mockmcp");
});

test("connect saves tools and keeps the other server", async () => {
  let saved = false;
  const agent = {
    _id: "agent1",
    mcp: {
      enabled: true,
      servers: [{ name: "other", transport: "http", url: "https://other.example/mcp", secretsEnc: "", cachedTools: [] }],
    },
    markModified() {},
    async save() {
      saved = true;
    },
  };
  const applied = await applyMcpServerFromChat({
    agent,
    userId: "user1",
    text: "connect mcp https://app.mockmcp.com/servers/abc/mcp token exampletokenvalue",
    discover: async () => ({
      ok: true,
      tools: [{ name: "GreetMe", description: "hi" }],
    }),
  });
  assert.equal(applied.ok, true);
  assert.match(applied.content, /Connected mockmcp/);
  assert.match(applied.content, /GreetMe/);
  assert.equal(saved, true);
  assert.equal(agent.mcp.servers.length, 2);
  assert.equal(agent.mcp.servers.some((server) => server.name === "other"), true);
  assert.equal(agent.mcp.servers.find((server) => server.name === "mockmcp").cachedTools[0].name, "GreetMe");
  assert.equal(applied.content.includes("exampletokenvalue"), false);
});

test("a failed connect does not save the server", async () => {
  let saved = false;
  const agent = {
    _id: "agent1",
    mcp: { enabled: false, servers: [] },
    markModified() {},
    async save() {
      saved = true;
    },
  };
  const applied = await applyMcpServerFromChat({
    agent,
    userId: "user1",
    text: "add mcp https://app.mockmcp.com/servers/abc/mcp bearer exampletokenvalue",
    discover: async () => ({ ok: false, detail: "401" }),
  });
  assert.equal(applied.ok, false);
  assert.match(applied.content, /Could not connect/);
  assert.equal(saved, false);
  assert.equal(agent.mcp.servers.length, 0);
});
