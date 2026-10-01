/**
 * @fileoverview Add, list, or remove an MCP server from a chat message.
 * Purpose: Same idea as a chat reminder — the sentence is saved on the agent, no settings form.
 * Downstream: chatAutoTurn.js before the model. Secrets stay encrypted.
 */

import { decryptSecret, encryptSecret } from "./crypto.js";
import { discoverMcpServerTools } from "./mcpClient.js";
import {
  mcpSlug,
  nameFromMcpUrl,
  normalizeMcpConfig,
  normalizeMcpUrl,
} from "./mcpRegistry.js";

/**
 * True when the message is about saving or removing an MCP server, not calling a tool.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeMcpServerManageRequest(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (/^(list|show)\s+(my\s+)?mcp servers?\b/i.test(raw)) return true;
  if (/\b(remove|delete|disconnect)\b[\s\S]{0,48}\bmcp\b/i.test(raw)) return true;
  if (/\b(add|connect|save|register)\b[\s\S]{0,48}\bmcp\b/i.test(raw)) return true;
  if (/\bmcp server\b/i.test(raw) && /https?:\/\//i.test(raw)) return true;
  return false;
}

/**
 * Pull a bearer token without treating ordinary words as the secret.
 * @param {string} text
 * @returns {string}
 */
function extractMcpToken(text) {
  const raw = String(text || "");
  const bearer = raw.match(/Bearer\s+([A-Za-z0-9._-]{8,})/i);
  if (bearer) return `Bearer ${bearer[1]}`;
  const labeled = raw.match(/\b(?:token|auth|authorization|key)\s*[:=]?\s*([A-Za-z0-9._-]{8,})/i);
  if (labeled) return `Bearer ${labeled[1]}`;
  return "";
}

/**
 * @param {string} text
 * @returns {string}
 */
function removeName(text) {
  const named = String(text || "").match(/\b(?:named|name)\s+([A-Za-z0-9_-]{2,48})/i);
  if (named) return mcpSlug(named[1]);
  const words = String(text || "")
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9_-]/g, ""))
    .filter((word) => word && !/^(remove|delete|disconnect|the|a|an|mcp|server|servers|please|my)$/.test(word));
  return mcpSlug(words[words.length - 1] || "");
}

/**
 * @param {string} text
 * @returns {{ action: "list"|"help"|"remove"|"add", url?: string, token?: string, name?: string, transport?: string }}
 */
export function parseMcpServerChat(text) {
  const raw = String(text || "").trim();
  if (/^(list|show)\s+(my\s+)?mcp servers?\b/i.test(raw)) return { action: "list" };
  if (/\b(remove|delete|disconnect)\b/i.test(raw)) {
    const url = normalizeMcpUrl(raw);
    return {
      action: "remove",
      url: /^https?:\/\//i.test(url) ? url : "",
      name: removeName(raw),
    };
  }
  const url = normalizeMcpUrl(raw);
  if (!/^https?:\/\//i.test(url)) return { action: "help" };
  const named = raw.match(/\b(?:named|name)\s+([A-Za-z0-9_-]{2,48})/i);
  return {
    action: "add",
    url,
    token: extractMcpToken(raw),
    name: named ? mcpSlug(named[1]) : "",
    transport: /\bsse\b/i.test(raw) ? "sse" : "http",
  };
}

/**
 * @param {object[]} servers
 * @returns {string}
 */
function formatServerList(servers) {
  if (!servers.length) {
    return "No MCP servers on this agent. Add one with: add mcp https://example.com/mcp bearer YOUR_TOKEN";
  }
  const lines = ["MCP servers on this agent:"];
  servers.forEach((server, index) => {
    let host = "";
    try {
      host = new URL(String(server.url || "")).host;
    } catch {
      host = "";
    }
    const tools = Array.isArray(server.cachedTools) ? server.cachedTools.length : 0;
    lines.push(`${index + 1}. ${server.name} (${server.transport || "http"})${host ? ` ${host}` : ""} — ${tools} tools`);
  });
  return lines.join("\n");
}

/**
 * A native mcp_server_manage call is the action. The arguments are the model's fields.
 * @param {Record<string, unknown>|null|undefined} args
 * @returns {{ action: "list"|"help"|"remove"|"add", url?: string, token?: string, name?: string, transport?: string }|null}
 */
export function mcpPlanFromToolArgs(args) {
  const raw = args && typeof args === "object" ? args : {};
  let action = String(raw.action || "").trim().toLowerCase();
  if (action === "show") action = "list";
  if (action === "connect" || action === "save" || action === "register") action = "add";
  if (action === "delete" || action === "disconnect") action = "remove";
  if (!["list", "add", "remove"].includes(action)) return null;
  if (action === "list") return { action: "list" };
  const url = normalizeMcpUrl(String(raw.url || ""));
  const name = mcpSlug(String(raw.name || raw.server || ""));
  if (action === "remove") return { action: "remove", url: /^https?:\/\//i.test(url) ? url : "", name };
  if (!/^https?:\/\//i.test(url)) return { action: "help" };
  const tokenRaw = String(raw.token || "").trim();
  const token = !tokenRaw ? "" : /^bearer\s+/i.test(tokenRaw) ? tokenRaw : `Bearer ${tokenRaw}`;
  return {
    action: "add",
    url,
    token,
    name,
    transport: String(raw.transport || "").toLowerCase() === "sse" ? "sse" : "http",
  };
}

/**
 * Save or remove one MCP server, then connect so the tool names are cached.
 * A parsed plan from mcp_server_manage is used when the model sent fields instead of a sentence.
 * @param {{ agent: object, userId: string, text?: string, parsed?: object, discover?: Function }} opts
 * @returns {Promise<{ ok: boolean, content: string }>}
 */
export async function applyMcpServerFromChat(opts) {
  const agent = opts?.agent;
  const parsed = opts?.parsed || parseMcpServerChat(opts?.text);
  if (!agent) return { ok: false, content: "This chat has no agent to attach the MCP server to." };
  const previous = typeof agent.mcp?.toObject === "function" ? agent.mcp.toObject() : agent.mcp || {};
  const current = Array.isArray(previous.servers) ? previous.servers : [];

  if (parsed.action === "list") {
    return { ok: true, content: formatServerList(current) };
  }
  if (parsed.action === "help") {
    return {
      ok: false,
      content:
        "Send the server URL and token in one message. Example: add mcp https://example.com/mcp bearer YOUR_TOKEN",
    };
  }
  if (parsed.action === "remove") {
    const name = mcpSlug(parsed.name);
    const nextServers = current.filter((server) => {
      if (name && mcpSlug(server.name) === name) return false;
      if (parsed.url && String(server.url || "") === parsed.url) return false;
      return true;
    });
    if (nextServers.length === current.length) {
      return { ok: false, content: "I could not find that MCP server on this agent." };
    }
    agent.mcp = normalizeMcpConfig(
      {
        enabled: nextServers.length > 0,
        servers: nextServers.map((server) => ({
          name: server.name,
          transport: server.transport,
          url: server.url,
          command: server.command,
          args: server.args,
          include: server.include,
          exclude: server.exclude,
        })),
      },
      previous,
      encryptSecret,
      decryptSecret
    );
    agent.markModified?.("mcp");
    await agent.save?.();
    return { ok: true, content: `Removed that MCP server. ${formatServerList(agent.mcp.servers || [])}` };
  }

  const name = mcpSlug(parsed.name) || nameFromMcpUrl(parsed.url);
  const kept = current.filter((server) => mcpSlug(server.name) !== name);
  if (kept.length >= 8) {
    return { ok: false, content: "This agent already has 8 MCP servers. Remove one first." };
  }
  const draft = normalizeMcpConfig(
    {
      enabled: true,
      servers: [
        ...kept.map((server) => ({
          name: server.name,
          transport: server.transport,
          url: server.url,
          command: server.command,
          args: server.args,
          include: server.include,
          exclude: server.exclude,
        })),
        {
          name,
          transport: parsed.transport || "http",
          url: parsed.url,
          headerAuthorization: parsed.token || "",
        },
      ],
    },
    previous,
    encryptSecret,
    decryptSecret
  );
  const server = (draft.servers || []).find((row) => row.name === name);
  if (!server) return { ok: false, content: "I could not read that MCP server URL." };
  // Why: connect before save so a bad URL or token never sticks on the agent.
  const discover = opts.discover || discoverMcpServerTools;
  const found = await discover(String(opts.userId || ""), String(agent._id || ""), server);
  if (!found.ok) {
    return {
      ok: false,
      content: `Could not connect to ${name}: ${found.detail || "the server did not answer."}`,
    };
  }
  server.cachedTools = found.tools || [];
  agent.mcp = draft;
  agent.markModified?.("mcp");
  await agent.save?.();
  const toolNames = (found.tools || []).map((tool) => tool.name).filter(Boolean);
  return {
    ok: true,
    content: `Connected ${name}. Tools: ${toolNames.length ? toolNames.join(", ") : "none listed"}.`,
  };
}
