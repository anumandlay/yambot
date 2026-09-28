/**
 * MCP name, filter, and config tests. No live server.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  filterMcpTools,
  mcpToolName,
  normalizeMcpConfig,
  publicMcpSummary,
  resolveMcpTool,
} from "../src/utils/mcpRegistry.js";

test("prefixes server and tool so they do not collide with native tools", () => {
  assert.equal(mcpToolName("github", "search_code"), "mcp_github_search_code");
  assert.equal(mcpToolName("File System", "read-file"), "mcp_file_system_read_file");
});

test("include and exclude filter the catalog", () => {
  const tools = [
    { name: "create_issue" },
    { name: "delete_customer" },
    { name: "search_code" },
  ];
  const kept = filterMcpTools(tools, {
    include: ["create_issue", "search_*"],
    exclude: ["delete_*"],
  });
  assert.deepEqual(
    kept.map((t) => t.name),
    ["create_issue", "search_code"]
  );
});

test("resolves an OpenAI name back to the remote tool", () => {
  const hit = resolveMcpTool(
    [{ name: "github", tools: [{ name: "search_code" }] }],
    "mcp_github_search_code"
  );
  assert.equal(hit?.remoteName, "search_code");
  assert.equal(hit?.server.name, "github");
});

test("keeps a previous secret when the form leaves the header blank", () => {
  const enc = (s) => `enc:${s}`;
  const dec = (s) => String(s).replace(/^enc:/, "");
  const prev = {
    enabled: true,
    servers: [
      {
        name: "remote",
        transport: "http",
        url: "https://mcp.example.com/mcp",
        secretsEnc: enc(JSON.stringify({ headers: { Authorization: "Bearer old" }, env: {} })),
        cachedTools: [{ name: "ping", description: "hi" }],
      },
    ],
  };
  const next = normalizeMcpConfig(
    {
      enabled: true,
      servers: [
        {
          name: "remote",
          transport: "http",
          url: "https://mcp.example.com/mcp",
          headerAuthorization: "",
          include: ["ping"],
        },
      ],
    },
    prev,
    enc,
    dec
  );
  assert.equal(next.servers[0].secretsEnc, prev.servers[0].secretsEnc);
  assert.equal(next.servers[0].include[0], "ping");
  const pub = publicMcpSummary({ mcp: next });
  assert.equal(pub.servers[0].hasSecrets, true);
  assert.equal(JSON.stringify(pub).includes("Bearer"), false);
});
