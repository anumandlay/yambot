/**
 * @fileoverview Settings → Composio — connect Phase-1 apps (Gmail / Slack / Sheets).
 * Purpose: Per-user OAuth via Composio; Auto chat uses composio_* tools after connect.
 * Downstream: GET/POST/DELETE `/api/settings/composio*`.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { SectionTitle } from "../components/FieldLabel.jsx";

/**
 * Composio Phase-1 connections page under Settings.
 */
export function SettingsComposioPage() {
  const [enabled, setEnabled] = useState(false);
  const [toolkits, setToolkits] = useState([]);
  const [connections, setConnections] = useState([]);
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState("");
  const [busy, setBusy] = useState(true);
  const [connecting, setConnecting] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const data = await api("/api/settings/composio");
      setEnabled(Boolean(data.enabled));
      setToolkits(Array.isArray(data.toolkits) ? data.toolkits : []);
      setConnections(Array.isArray(data.connections) ? data.connections : []);
      setError(null);
      if (data.error && data.enabled) {
        setOkMsg("");
        setError({ title: "Composio warning", detail: data.error });
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * @param {string} toolkit
   */
  async function onConnect(toolkit) {
    setConnecting(toolkit);
    setError(null);
    setOkMsg("");
    try {
      const data = await api("/api/settings/composio/connect", {
        method: "POST",
        body: JSON.stringify({ toolkit }),
      });
      const url = String(data.redirectUrl || "").trim();
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
        setOkMsg(
          data.message ||
            "Opened the connect page in a new tab. Finish authorizing, then click Refresh."
        );
      } else {
        setOkMsg(data.message || "Connect started.");
      }
    } catch (err) {
      setError(err);
    } finally {
      setConnecting("");
    }
  }

  /**
   * @param {string} id
   */
  async function onDisconnect(id) {
    if (!window.confirm("Disconnect this Composio app?")) return;
    setError(null);
    setOkMsg("");
    try {
      await api(`/api/settings/composio/connections/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setOkMsg("Disconnected.");
      await load();
    } catch (err) {
      setError(err);
    }
  }

  /**
   * @param {string} slug
   * @returns {object|null}
   */
  function connectionFor(slug) {
    const s = String(slug || "").toLowerCase();
    return (
      connections.find((c) => String(c.toolkit || "").toLowerCase() === s) ||
      connections.find((c) => String(c.toolkit || "").toLowerCase().includes(s)) ||
      null
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold text-teal-950">Composio apps</h2>
        <p className="mt-1 text-sm text-teal-900/70">
          Phase 1: connect Gmail, Slack, or Google Sheets. Auto chat can then call those apps
          without opening the cloud browser. OAuth stays with Composio — YamBot only stores a
          session handle.
        </p>
      </div>

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}
      {okMsg ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
          {okMsg}
        </p>
      ) : null}

      {busy ? (
        <p className="text-sm text-teal-900/70">Loading Composio…</p>
      ) : !enabled ? (
        <section className="rounded-2xl border border-amber-100 bg-amber-50/50 p-4 text-sm text-amber-950">
          Composio is off on this server. Add <code className="font-mono">COMPOSIO_API_KEY</code>{" "}
          to the API env (and optionally <code className="font-mono">COMPOSIO_ENABLED=1</code>),
          then redeploy.
        </section>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="min-h-11 rounded-xl border border-teal-200 bg-white px-4 text-sm font-semibold text-teal-900"
            >
              Refresh status
            </button>
          </div>

          <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
            <SectionTitle className="mb-3">Available apps</SectionTitle>
            <ul className="space-y-3">
              {toolkits.map((tk) => {
                const conn = connectionFor(tk.slug);
                const connected = Boolean(conn && /active|connected|enabled/i.test(conn.status || "active"));
                return (
                  <li
                    key={tk.slug}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-teal-50 bg-teal-50/30 px-3 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-teal-950">{tk.label}</div>
                      <p className="text-xs text-teal-900/70">{tk.blurb}</p>
                      <p className="mt-1 text-[0.7rem] font-semibold text-teal-800/60">
                        {connected
                          ? `Connected${conn?.status ? ` · ${conn.status}` : ""}`
                          : "Not connected"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={Boolean(connecting)}
                        onClick={() => void onConnect(tk.slug)}
                        className="min-h-10 rounded-xl bg-teal-700 px-3 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {connecting === tk.slug ? "Opening…" : connected ? "Reconnect" : "Connect"}
                      </button>
                      {conn?.id ? (
                        <button
                          type="button"
                          onClick={() => void onDisconnect(conn.id)}
                          className="min-h-10 rounded-xl border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-800"
                        >
                          Disconnect
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <p className="text-xs text-teal-900/60">
            Prefer Agents → edit → Composio for a per-agent API key and app picker. This page uses
            the server COMPOSIO_API_KEY when set. After connecting, try in Auto chat: “list my
            composio apps”.
          </p>
        </>
      )}
    </div>
  );
}
