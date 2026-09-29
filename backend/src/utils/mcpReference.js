/**
 * @fileoverview Resolve short chat replies onto an MCP tool before the model answers.
 * Purpose: a name after "whose name?" and a yes or no are references, not new questions.
 * A row word or a bare number is left for the model, which copies the tool name.
 * Downstream: chatAutoTurn.js calls the resolved tool or asks for the missing argument.
 */

import { mcpToolName } from "./mcpRegistry.js";

/**
 * MCP tool names already shown, in first-seen order.
 * @param {string} text
 * @returns {string[]}
 */
export function mcpToolsMentioned(text) {
  const seen = new Set();
  /** @type {string[]} */
  const names = [];
  const re = /mcp_[a-z0-9_]+/gi;
  let match;
  const raw = String(text || "");
  while ((match = re.exec(raw))) {
    const name = String(match[0] || "").toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/**
 * Numbered catalog from tools saved at Connect time.
 * Why: the next "1" can be mapped without asking the model to remember the list.
 * @param {object|null|undefined} agent
 * @returns {string}
 */
export function formatCachedMcpCatalog(agent) {
  const servers = Array.isArray(agent?.mcp?.servers) ? agent.mcp.servers : [];
  /** @type {string[]} */
  const lines = [];
  let n = 1;
  for (const server of servers) {
    const serverName = String(server?.name || "").trim();
    const tools = Array.isArray(server?.cachedTools) ? server.cachedTools : [];
    if (!serverName || !tools.length) continue;
    lines.push(`Server: ${serverName}`);
    for (const tool of tools) {
      const label = String(tool?.description || tool?.name || "").replace(/\s+/g, " ").slice(0, 140);
      lines.push(`${n}. ${mcpToolName(serverName, tool?.name)} — ${label}`);
      n += 1;
    }
  }
  return lines.join("\n");
}

/**
 * @param {string} last
 * @param {string[]} catalog
 * @returns {string}
 */
function toolFromQuestion(last, catalog) {
  const named = String(last || "").match(/mcp_[a-z0-9_]+/i);
  if (named) return named[0].toLowerCase();
  const numbered = String(last || "").match(/tool\s*#?\s*(\d{1,2})/i);
  if (numbered) return catalog[Number(numbered[1]) - 1] || "";
  return catalog[0] || "";
}

/**
 * Resolve a short follow-up against the recent MCP list or a pending question.
 * Priority: a question waiting for a name, then a yes/no confirmation.
 * A row word or a bare number is left for the model, which copies the tool name.
 * @param {string} text
 * @param {{ role?: string, content?: string }[]} [historyMessages]
 * @returns {null | { kind: "list", source: string } | { kind: "ask", question: string } | { kind: "call", tool: string, args: Record<string, string>, source: string }}
 */
export function resolveMcpReference(text, historyMessages = []) {
  const q = String(text || "").trim();
  if (!q || q.length > 80) return null;
  if (/^(?:list|show|what are)(?:\s+of)?(?:\s+(?:the|my))?\s+mcps?\b/i.test(q) || /^mcps?\??$/i.test(q)) {
    return { kind: "list", source: "catalog_request" };
  }
  const recent = (Array.isArray(historyMessages) ? historyMessages : [])
    .filter((row) => row?.role === "assistant" && String(row?.content || "").trim())
    .slice(-4);
  const last = recent[recent.length - 1];
  const catalog = mcpToolsMentioned(recent.map((row) => row.content).join("\n"));
  if (!catalog.length || !last) return null;
  const previous = String(last.content || "");
  const waitingForName = /whose name|what name|which name|name should i use/i.test(previous);
  if (waitingForName) {
    const tool = toolFromQuestion(previous, catalog);
    if (!tool) return null;
    if (/^[A-Za-z][A-Za-z .'-]{0,40}$/.test(q)) {
      return { kind: "call", tool, args: { name: q }, source: "pending_question" };
    }
    return null;
  }
  return null;
}
