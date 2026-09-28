/**
 * @fileoverview Long-lived MCP client pool.
 * Purpose: One warm connection per agent server (stdio, streamable HTTP, or SSE).
 * Tool calls reuse that session instead of connect/disconnect each time.
 * Downstream: Auto chat when the model calls mcp_<server>_<tool>.
 */

import { decryptSecret } from "./crypto.js";
import { filterMcpTools, mcpToolsToOpenAi, resolveMcpTool } from "./mcpRegistry.js";

/** @type {Map<string, { client: object, transport: object, tools: object[], at: number }>} */
const pool = new Map();

/**
 * Decrypt headers and env stored on a server row.
 * @param {object} server
 * @returns {{ headers: Record<string, string>, env: Record<string, string> }}
 */
export function readMcpSecrets(server) {
  const enc = String(server?.secretsEnc || "");
  if (!enc) return { headers: {}, env: {} };
  try {
    const parsed = JSON.parse(decryptSecret(enc) || "{}");
    return {
      headers: parsed.headers && typeof parsed.headers === "object" ? parsed.headers : {},
      env: parsed.env && typeof parsed.env === "object" ? parsed.env : {},
    };
  } catch {
    return { headers: {}, env: {} };
  }
}

/**
 * @param {object} server
 * @param {{ headers?: Record<string, string>, env?: Record<string, string> }} secrets
 * @returns {Promise<object>}
 */
async function openTransport(server, secrets) {
  const transport = String(server?.transport || "http");
  if (transport === "stdio") {
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const command = String(server.command || "").trim();
    if (!command) throw new Error("stdio MCP server needs a command");
    return new StdioClientTransport({
      command,
      args: Array.isArray(server.args) ? server.args : [],
      env: secrets.env || {},
      stderr: "pipe",
    });
  }
  const url = String(server.url || "").trim();
  if (!url) throw new Error("HTTP MCP server needs a url");
  const requestInit = {
    headers: { ...(secrets.headers || {}) },
  };
  if (transport === "sse") {
    const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");
    return new SSEClientTransport(new URL(url), { requestInit });
  }
  const { StreamableHTTPClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/streamableHttp.js"
  );
  return new StreamableHTTPClientTransport(new URL(url), { requestInit });
}

/**
 * Connect once and keep the session. A dead session is dropped and opened again.
 * @param {string} poolKey
 * @param {object} server
 * @returns {Promise<{ client: object, tools: object[] }>}
 */
export async function ensureMcpSession(poolKey, server) {
  const existing = pool.get(poolKey);
  if (existing?.client) return existing;
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const secrets = readMcpSecrets(server);
  const transport = await openTransport(server, secrets);
  const client = new Client({ name: "yambot", version: "1.0.0" });
  await client.connect(transport);
  const listed = await client.listTools();
  const tools = filterMcpTools(listed?.tools || [], {
    include: server.include,
    exclude: server.exclude,
  });
  const session = { client, transport, tools, at: Date.now() };
  pool.set(poolKey, session);
  return session;
}

/**
 * Drop one session so the next call reconnects.
 * @param {string} poolKey
 */
export async function closeMcpSession(poolKey) {
  const session = pool.get(poolKey);
  pool.delete(poolKey);
  if (!session) return;
  try {
    await session.client.close?.();
  } catch {
    /* already closed */
  }
  try {
    await session.transport.close?.();
  } catch {
    /* already closed */
  }
}

/**
 * @param {string} userId
 * @param {string} agentId
 * @param {object} server
 * @returns {string}
 */
function poolKeyFor(userId, agentId, server) {
  return `${userId}:${agentId}:${server.name}`;
}

/**
 * OpenAI tool defs for every enabled server. Connections stay in the pool.
 * @param {{ userId?: string, agentId?: string, agent?: object }} runtime
 * @returns {Promise<object[]>}
 */
export async function loadMcpOpenAiTools(runtime) {
  const agent = runtime?.agent;
  const mcp = agent?.mcp;
  if (!mcp?.enabled) return [];
  const userId = String(runtime.userId || "");
  const agentId = String(runtime.agentId || agent?._id || "");
  if (!userId || !agentId) return [];
  /** @type {object[]} */
  const out = [];
  for (const server of mcp.servers || []) {
    if (!server?.name) continue;
    if (out.length >= 32) break;
    try {
      const session = await ensureMcpSession(poolKeyFor(userId, agentId, server), server);
      const room = 32 - out.length;
      out.push(...mcpToolsToOpenAi(server.name, session.tools).slice(0, room));
    } catch (err) {
      console.warn(`[mcp] ${server.name} list failed:`, err?.message || err);
    }
  }
  return out;
}

/**
 * Call one mcp_* tool on the warm session.
 * @param {{ userId?: string, agentId?: string, agent?: object }} runtime
 * @param {string} openaiName
 * @param {object} args
 * @returns {Promise<string>}
 */
export async function callRegisteredMcpTool(runtime, openaiName, args) {
  const agent = runtime?.agent;
  const servers = agent?.mcp?.servers || [];
  const userId = String(runtime?.userId || "");
  const agentId = String(runtime?.agentId || agent?._id || "");
  if (!agent?.mcp?.enabled) {
    return JSON.stringify({ ok: false, detail: "MCP is off for this agent." });
  }
  const keyServers = [];
  for (const server of servers) {
    let tools = [];
    try {
      const session = await ensureMcpSession(poolKeyFor(userId, agentId, server), server);
      tools = session.tools;
    } catch (err) {
      tools = [];
      server._connectError = err?.message || String(err);
    }
    keyServers.push({ ...server, tools });
  }
  const hit = resolveMcpTool(keyServers, openaiName);
  if (!hit) {
    return JSON.stringify({
      ok: false,
      detail: `No MCP tool named ${openaiName}. Discover the server and check include/exclude.`,
    });
  }
  const poolKey = poolKeyFor(userId, agentId, hit.server);
  try {
    const session = await ensureMcpSession(poolKey, hit.server);
    const result = await session.client.callTool({
      name: hit.remoteName,
      arguments: args && typeof args === "object" ? args : {},
    });
    const text = (result?.content || [])
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
    return JSON.stringify({
      ok: !result?.isError,
      tool: hit.remoteName,
      server: hit.server.name,
      text: text.slice(0, 8000),
      structured: result?.structuredContent || undefined,
    }).slice(0, 12000);
  } catch (err) {
    await closeMcpSession(poolKey);
    return JSON.stringify({
      ok: false,
      detail: String(err?.message || err).slice(0, 500),
    });
  }
}

/**
 * Connect, list, and return the filtered tool catalog (also warms the pool).
 * @param {string} userId
 * @param {string} agentId
 * @param {object} server
 * @returns {Promise<{ ok: boolean, tools?: object[], detail?: string }>}
 */
export async function discoverMcpServerTools(userId, agentId, server) {
  const poolKey = poolKeyFor(userId, agentId, server);
  await closeMcpSession(poolKey);
  try {
    const session = await ensureMcpSession(poolKey, server);
    return {
      ok: true,
      tools: session.tools.map((t) => ({
        name: t.name,
        description: String(t.description || "").slice(0, 300),
      })),
    };
  } catch (err) {
    return { ok: false, detail: String(err?.message || err).slice(0, 400) };
  }
}
