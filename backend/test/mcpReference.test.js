/**
 * Short MCP follow-ups resolve before the chat model.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { formatCachedMcpCatalog, resolveMcpReference } from "../src/utils/mcpReference.js";

const list = [
  {
    role: "assistant",
    content: [
      "Server: mockmcp",
      "1. mcp_mockmcp_greetme — greet a user by name",
      "2. mcp_mockmcp_mockmcpstatus — get the server status",
      "3. mcp_mockmcp_generatecar — generate a car image",
      "4. mcp_mockmcp_generatebike — generate a bike image",
    ].join("\n"),
  },
];

test("lists MCP tools without a model call", () => {
  assert.equal(resolveMcpReference("list of mcps", [])?.kind, "list");
});

test("a row word or a bare number is left for the model", () => {
  assert.equal(resolveMcpReference("1", list), null);
  assert.equal(resolveMcpReference("the second one", list), null);
  assert.equal(resolveMcpReference("yes", list), null);
});

test("a pending name question wins over the old numbered list", () => {
  const history = [
    ...list,
    { role: "assistant", content: "Whose name should I use for mcp_mockmcp_greetme?" },
  ];
  const named = resolveMcpReference("Ayamu", history);
  assert.equal(named?.tool, "mcp_mockmcp_greetme");
  assert.equal(named?.args?.name, "Ayamu");
  assert.equal(resolveMcpReference("1", history), null);
});

test("yes confirms a pending tool call and keeps an offered name", () => {
  const history = [
    ...list,
    {
      role: "assistant",
      content: "Should I call mcp_mockmcp_greetme for (Ayamu)? Yes or no?",
    },
  ];
  const yes = resolveMcpReference("yes", history);
  assert.equal(yes?.tool, "mcp_mockmcp_greetme");
  assert.equal(yes?.args?.name, "Ayamu");
  assert.equal(yes?.source, "pending_confirmation");
});

test("catalog text uses the same names the resolver reads", () => {
  const text = formatCachedMcpCatalog({
    mcp: {
      servers: [
        {
          name: "mockmcp",
          cachedTools: [
            { name: "GreetMe", description: "Greet the user" },
            { name: "mockmcpStatus", description: "Get the server status" },
          ],
        },
      ],
    },
  });
  assert.match(text, /1\. mcp_mockmcp_greetme/);
  assert.equal(resolveMcpReference("1", [{ role: "assistant", content: text }]), null);
});
