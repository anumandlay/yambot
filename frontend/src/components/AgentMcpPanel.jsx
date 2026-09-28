/**
 * @fileoverview Agent editor tab for external MCP servers.
 * Purpose: Save server config (HTTP, SSE, or stdio) and discover tools.
 * Downstream: PUT /api/agents and POST /api/agents/:id/mcp/discover.
 */

import { useState } from "react";
import { api } from "../lib/api.js";

/**
 * @param {object} props
 * @param {object} props.form
 * @param {(updater: (prev: object) => object) => void} props.setForm
 * @param {string} props.agentId
 * @param {boolean} props.isNew
 */
export function AgentMcpPanel({ form, setForm, agentId, isNew }) {
  const mcp = form.mcp || { enabled: false, servers: [] };
  const servers = Array.isArray(mcp.servers) ? mcp.servers : [];
  const [busyName, setBusyName] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const blank = {
    name: "",
    transport: "http",
    url: "",
    command: "",
    argsText: "",
    include: "",
    exclude: "",
    headerAuthorization: "",
    envText: "",
    tools: [],
  };
  const draft = servers.length === 0;
  const rows = draft ? [blank] : servers;

  /**
   * Name used when the nickname box is empty. mockmcp.com → mockmcp.
   * @param {string} url
   * @returns {string}
   */
  function nameFromUrl(url) {
    try {
      const host = new URL(String(url).trim()).hostname.replace(/^www\./, "");
      const parts = host.split(".").filter(Boolean);
      const base = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
      return String(base || "mcp")
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_");
    } catch {
      return "mcp";
    }
  }

  /**
   * @param {object} next
   */
  function setMcp(next) {
    setForm((prev) => ({ ...prev, mcp: next }));
  }

  /**
   * @param {number} index
   * @param {string} key
   * @param {string|boolean} value
   */
  function patchServer(index, key, value) {
    if (draft) {
      setMcp({ enabled: true, servers: [{ ...blank, [key]: value }] });
      return;
    }
    const next = servers.map((row, i) => (i === index ? { ...row, [key]: value } : row));
    setMcp({ ...mcp, enabled: true, servers: next });
  }

  function addServer() {
    setMcp({
      ...mcp,
      servers: [
        ...servers,
        {
          name: "",
          transport: "http",
          url: "",
          command: "",
          argsText: "",
          include: "",
          exclude: "",
          headerAuthorization: "",
          envText: "",
          tools: [],
        },
      ].slice(0, 8),
    });
  }

  /**
   * @param {number} index
   */
  async function discover(index) {
    const row = rows[index];
    const url = String(row?.url || "").trim();
    if ((row?.transport || "http") !== "stdio" && !url) {
      setErr("Paste the MCP URL, then connect.");
      return;
    }
    if (isNew) {
      setErr("Save the agent first, then connect.");
      return;
    }
    const name = String(row?.name || "").trim() || nameFromUrl(url);
    const nextServers = draft
      ? [{ ...blank, ...row, name }]
      : servers.map((item, i) => (i === index ? { ...item, name } : item));
    const nextMcp = { ...mcp, enabled: true, servers: nextServers };
    setMcp(nextMcp);
    setBusyName(name);
    setErr("");
    setNote("Connecting…");
    try {
      await api(`/api/agents/${agentId}`, {
        method: "PUT",
        body: JSON.stringify({ mcp: nextMcp }),
        timeoutMs: 20000,
      });
      const data = await api(`/api/agents/${agentId}/mcp/discover`, {
        method: "POST",
        body: JSON.stringify({ name }),
        timeoutMs: 60000,
      });
      const tools = data.tools || [];
      setMcp({
        ...nextMcp,
        servers: nextMcp.servers.map((item) =>
          item.name === name ? { ...item, tools, headerAuthorization: "" } : item
        ),
      });
      setNote(
        tools.length
          ? `Connected ${name}. Tools: ${tools.map((t) => t.name).join(", ")}`
          : `Connected ${name}. This server returned no tools.`
      );
    } catch (e) {
      setNote("");
      setErr(e?.detail || e?.message || "Discover failed");
    } finally {
      setBusyName("");
    }
  }

  return (
    <div className="flex flex-col gap-3" role="tabpanel">
      <fieldset className="flex flex-col gap-3 rounded-xl border border-teal-100 bg-white/70 p-3 sm:p-4">
        <div className="text-sm font-semibold text-teal-900">MCP servers</div>
        <p className="text-xs text-teal-900/70">
          For MockMCP choose Streamable HTTP, paste the server URL, paste the auth token, then
          Connect. The name can stay blank. A blank token box keeps the saved token.
        </p>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(mcp.enabled)}
            onChange={(e) => setMcp({ ...mcp, enabled: e.target.checked })}
          />
          Enable MCP for this agent
        </label>
        {rows.map((row, index) => (
          <div key={index} className="flex flex-col gap-2 rounded-lg border border-teal-100 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs">
                Name
                <input
                  className="min-h-11 rounded-lg border border-teal-200 px-2 text-sm"
                  value={row.name || ""}
                  onChange={(e) => patchServer(index, "name", e.target.value)}
                  placeholder="optional — filled from the URL"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Transport
                <select
                  className="min-h-11 rounded-lg border border-teal-200 px-2 text-sm"
                  value={row.transport || "http"}
                  onChange={(e) => patchServer(index, "transport", e.target.value)}
                >
                  <option value="http">Streamable HTTP</option>
                  <option value="sse">SSE</option>
                  <option value="stdio">stdio</option>
                </select>
              </label>
            </div>
            {row.transport === "stdio" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs">
                  Command
                  <input
                    className="min-h-11 rounded-lg border border-teal-200 px-2 text-sm"
                    value={row.command || ""}
                    onChange={(e) => patchServer(index, "command", e.target.value)}
                    placeholder="npx"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  Args
                  <input
                    className="min-h-11 rounded-lg border border-teal-200 px-2 text-sm"
                    value={row.argsText || (Array.isArray(row.args) ? row.args.join(" ") : "")}
                    onChange={(e) => patchServer(index, "argsText", e.target.value)}
                    placeholder="-y @modelcontextprotocol/server-filesystem /data"
                  />
                </label>
              </div>
            ) : (
              <label className="flex flex-col gap-1 text-xs">
                URL
                <input
                  className="min-h-11 rounded-lg border border-teal-200 px-2 text-sm"
                  value={row.url || ""}
                  onChange={(e) => patchServer(index, "url", e.target.value)}
                  placeholder="https://mcp.example.com/mcp"
                />
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs">
              Auth token
              <input
                type="password"
                className="min-h-11 rounded-lg border border-teal-200 px-2 text-sm"
                value={row.headerAuthorization || ""}
                onChange={(e) => patchServer(index, "headerAuthorization", e.target.value)}
                placeholder={row.hasSecrets ? "Saved — leave blank to keep" : "Bearer token or the raw token"}
                autoComplete="off"
              />
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs">
                Include tools
                <input
                  className="min-h-11 rounded-lg border border-teal-200 px-2 text-sm"
                  value={Array.isArray(row.include) ? row.include.join(", ") : row.include || ""}
                  onChange={(e) => patchServer(index, "include", e.target.value)}
                  placeholder="search_code, create_issue"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Exclude tools
                <input
                  className="min-h-11 rounded-lg border border-teal-200 px-2 text-sm"
                  value={Array.isArray(row.exclude) ? row.exclude.join(", ") : row.exclude || ""}
                  onChange={(e) => patchServer(index, "exclude", e.target.value)}
                  placeholder="delete_*"
                />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-xs">
              Extra env (stdio)
              <textarea
                className="min-h-16 rounded-lg border border-teal-200 px-2 py-2 text-sm"
                value={row.envText || ""}
                onChange={(e) => patchServer(index, "envText", e.target.value)}
                placeholder={"GITHUB_TOKEN=…"}
              />
            </label>
            {Array.isArray(row.tools) && row.tools.length ? (
              <p className="text-xs text-teal-900/70">
                {row.tools.map((t) => t.name).join(", ")}
              </p>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                className="min-h-11 rounded-lg bg-teal-800 px-3 text-sm text-white disabled:opacity-50"
                disabled={Boolean(busyName)}
                onClick={() => discover(index)}
              >
                {busyName && busyName === (row.name || nameFromUrl(row.url)) ? "Connecting…" : "Connect"}
              </button>
              <button
                type="button"
                className="min-h-11 rounded-lg border border-teal-200 px-3 text-sm"
                onClick={() => setMcp({ ...mcp, servers: servers.filter((_, i) => i !== index) })}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="min-h-11 rounded-lg border border-teal-300 px-3 text-sm"
          onClick={addServer}
        >
          Add server
        </button>
        {note ? <p className="text-xs text-teal-800">{note}</p> : null}
        {err ? <p className="text-xs text-red-700">{err}</p> : null}
        {isNew ? <p className="text-xs text-teal-900/60">Save the agent first, then discover tools.</p> : null}
      </fieldset>
    </div>
  );
}
