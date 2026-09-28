/**
 * @fileoverview MCP tool names, filters, and public config (no live connection).
 * Purpose: Hermes-style `mcp_<server>_<tool>` names plus include/exclude so the model
 * does not receive every tool a server exposes.
 * Downstream: mcpClient.js, Agent.mcp, Auto chat tools.
 */

/**
 * Pull a usable server name from an MCP URL when the form name is blank.
 * Why: MockMCP and similar cards ask for type, URL, and token — not a nickname.
 * @param {string} url
 * @returns {string}
 */
export function nameFromMcpUrl(url) {
  try {
    const host = new URL(String(url || "").trim()).hostname.replace(/^www\./, "");
    const parts = host.split(".").filter(Boolean);
    const base = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    return mcpSlug(base);
  } catch {
    return "";
  }
}

/**
 * Turn a pasted auth box into one Authorization header value.
 * Why: people paste "Bearer …", the raw token, or the URL and the token together.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeAuthHeader(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const bearer = text.match(/Bearer\s+([A-Za-z0-9._-]+)/i);
  if (bearer) return `Bearer ${bearer[1]}`;
  const token = text
    .split(/\s+/)
    .map((part) => part.trim())
    .find((part) => part && !/^https?:\/\//i.test(part));
  if (!token) return "";
  return `Bearer ${token}`;
}

/**
 * Keep only the http(s) URL if the box also contains a token.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeMcpUrl(raw) {
  const text = String(raw || "").trim();
  const match = text.match(/https?:\/\/[^\s]+/i);
  return (match ? match[0] : text).replace(/[),]+$/, "").slice(0, 500);
}

/**
 * Safe slug for a server or tool name inside an OpenAI function name.
 * @param {string} value
 * @returns {string}
 */
export function mcpSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

/**
 * OpenAI tool name the model calls.
 * @param {string} serverName
 * @param {string} toolName remote MCP tool name
 * @returns {string}
 */
export function mcpToolName(serverName, toolName) {
  return `mcp_${mcpSlug(serverName)}_${mcpSlug(toolName)}`;
}

/**
 * Glob or exact match. `*` is the only wildcard.
 * @param {string} name
 * @param {string} pattern
 * @returns {boolean}
 */
function nameMatches(name, pattern) {
  const p = String(pattern || "").trim();
  if (!p) return false;
  if (!p.includes("*")) return name === p;
  const body = p
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}$`).test(name);
}

/**
 * Keep only the tools this server is allowed to show the model.
 * Why: a server can expose hundreds of tools; include/exclude is the Hermes filter.
 * @param {{ name: string, description?: string, inputSchema?: object }[]} tools
 * @param {{ include?: string[], exclude?: string[] }} [spec]
 * @returns {object[]}
 */
export function filterMcpTools(tools, spec = {}) {
  const include = Array.isArray(spec.include) ? spec.include.map((s) => String(s).trim()).filter(Boolean) : [];
  const exclude = Array.isArray(spec.exclude) ? spec.exclude.map((s) => String(s).trim()).filter(Boolean) : [];
  return (Array.isArray(tools) ? tools : []).filter((tool) => {
    const name = String(tool?.name || "").trim();
    if (!name) return false;
    if (exclude.some((p) => nameMatches(name, p))) return false;
    if (include.length && !include.some((p) => nameMatches(name, p))) return false;
    return true;
  });
}

/**
 * Plain server row for tool lookup.
 * Why: Agent.mcp.servers is a Mongoose subdocument. Spreading it drops `name`,
 * so a live tool such as mcp_mockmcp_greetme fails to resolve even though the model was given that name.
 * @param {object} server
 * @returns {object}
 */
export function plainMcpServer(server) {
  const src = typeof server?.toObject === "function" ? server.toObject() : server || {};
  return {
    name: String(src.name || server?.name || ""),
    transport: String(src.transport || server?.transport || "http"),
    url: String(src.url || server?.url || ""),
    command: String(src.command || server?.command || ""),
    args: Array.isArray(src.args) ? src.args : Array.isArray(server?.args) ? server.args : [],
    include: Array.isArray(src.include) ? src.include : Array.isArray(server?.include) ? server.include : [],
    exclude: Array.isArray(src.exclude) ? src.exclude : Array.isArray(server?.exclude) ? server.exclude : [],
    secretsEnc: String(src.secretsEnc || server?.secretsEnc || ""),
    cachedTools: Array.isArray(src.cachedTools)
      ? src.cachedTools
      : Array.isArray(server?.cachedTools)
        ? server.cachedTools
        : [],
  };
}

/**
 * Find which configured server and remote tool an OpenAI name refers to.
 * @param {{ name: string, tools?: { name: string }[] }[]} servers
 * @param {string} openaiName
 * @returns {{ server: object, remoteName: string } | null}
 */
export function resolveMcpTool(servers, openaiName) {
  const wanted = String(openaiName || "").trim();
  for (const server of servers || []) {
    const prefix = `mcp_${mcpSlug(server?.name)}_`;
    if (!wanted.startsWith(prefix)) continue;
    const rest = wanted.slice(prefix.length);
    const tools = Array.isArray(server.tools) ? server.tools : [];
    const hit = tools.find((t) => mcpSlug(t?.name) === rest);
    if (hit?.name) return { server, remoteName: String(hit.name) };
  }
  return null;
}

/**
 * Extra env the user typed, never the whole process environment.
 * @param {string} text lines of KEY=value
 * @returns {Record<string, string>}
 */
export function parseMcpEnvText(text) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    env[key] = value;
  }
  return env;
}

/**
 * Split a comma or newline list.
 * @param {unknown} raw
 * @returns {string[]}
 */
function nameList(raw) {
  const parts = Array.isArray(raw) ? raw : String(raw || "").split(/[\n,]/);
  return [...new Set(parts.map((s) => String(s).trim()).filter(Boolean))].slice(0, 80);
}

/**
 * Shape stored on the agent. Secrets stay encrypted; cached tool names are public.
 * @param {object} raw request body mcp object
 * @param {object|null} [previous] existing agent.mcp
 * @param {(plain: string) => string} encrypt
 * @param {(payload: string) => string} decrypt
 * @returns {object}
 */
export function normalizeMcpConfig(raw, previous, encrypt, decrypt) {
  const prevServers = Array.isArray(previous?.servers) ? previous.servers : [];
  const prevByName = new Map(prevServers.map((s) => [String(s?.name || ""), s]));
  const incoming = Array.isArray(raw?.servers) ? raw.servers : [];
  const servers = [];
  const seen = new Set();
  for (const row of incoming.slice(0, 8)) {
    if (!row || typeof row !== "object") continue;
    const url = normalizeMcpUrl(row.url);
    const name = mcpSlug(row.name) || nameFromMcpUrl(url);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const transport = ["stdio", "http", "sse"].includes(row.transport) ? row.transport : "http";
    const prev = prevByName.get(name);
    let secretsEnc = String(prev?.secretsEnc || "");
    if (row.clearSecrets) {
      secretsEnc = "";
    } else {
      const header = String(row.headerAuthorization || "").trim();
      const env = parseMcpEnvText(row.envText || "");
      if (header || Object.keys(env).length) {
        let prevSecrets = {};
        try {
          prevSecrets = secretsEnc ? JSON.parse(decrypt(secretsEnc) || "{}") : {};
        } catch {
          prevSecrets = {};
        }
        const headers = { ...(prevSecrets.headers || {}) };
        if (header) headers.Authorization = normalizeAuthHeader(header);
        const nextEnv = Object.keys(env).length ? env : prevSecrets.env || {};
        secretsEnc = encrypt(JSON.stringify({ headers, env: nextEnv }));
      }
    }
    const args = String(row.argsText || "").trim()
      ? String(row.argsText)
          .split(/\s+/)
          .map((a) => a.trim())
          .filter(Boolean)
          .slice(0, 20)
      : Array.isArray(row.args)
        ? row.args.map((a) => String(a)).slice(0, 20)
        : [];
    servers.push({
      name,
      transport,
      url,
      command: String(row.command || "").trim().slice(0, 200),
      args,
      include: nameList(row.include),
      exclude: nameList(row.exclude),
      secretsEnc,
      cachedTools: Array.isArray(prev?.cachedTools) ? prev.cachedTools : [],
    });
  }
  return {
    enabled: Boolean(raw?.enabled) || servers.length > 0,
    servers,
  };
}

/**
 * Agent edit payload: no secrets, tool names only.
 * @param {object|null|undefined} agent
 * @returns {object}
 */
export function publicMcpSummary(agent) {
  const mcp = agent?.mcp || {};
  const servers = Array.isArray(mcp.servers) ? mcp.servers : [];
  return {
    enabled: Boolean(mcp.enabled),
    servers: servers.map((s) => ({
      name: s.name || "",
      transport: s.transport || "http",
      url: s.url || "",
      command: s.command || "",
      args: Array.isArray(s.args) ? s.args : [],
      include: Array.isArray(s.include) ? s.include : [],
      exclude: Array.isArray(s.exclude) ? s.exclude : [],
      hasSecrets: Boolean(s.secretsEnc),
      tools: (Array.isArray(s.cachedTools) ? s.cachedTools : []).map((t) => ({
        name: t.name || "",
        description: t.description || "",
      })),
    })),
  };
}

/**
 * OpenAI function tools from a discovered, already-filtered list.
 * @param {string} serverName
 * @param {{ name: string, description?: string, inputSchema?: object }[]} tools
 * @returns {object[]}
 */
export function mcpToolsToOpenAi(serverName, tools) {
  return (tools || []).slice(0, 24).map((tool) => {
    const schema =
      tool.inputSchema && typeof tool.inputSchema === "object"
        ? tool.inputSchema
        : { type: "object", properties: {} };
    return {
      type: "function",
      function: {
        name: mcpToolName(serverName, tool.name),
        description: `MCP ${serverName}: ${String(tool.description || tool.name).slice(0, 400)}`,
        parameters: schema,
      },
    };
  });
}
