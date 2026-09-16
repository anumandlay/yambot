/**
 * @fileoverview Agent↔Agent threads — human view of message_agent conversations.
 * Purpose: Group hops by conversationKey so operators can follow A→B (and B→C) threads.
 * Downstream: GET /api/agent-messages/threads.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { PageGuideBanner } from "../components/FieldLabel.jsx";

/**
 * @param {object} thread
 * @returns {string}
 */
function participantsLabel(thread) {
  const names = (thread.participants || []).map((p) => p.name).filter(Boolean);
  return names.length ? names.join(" · ") : "Agents";
}

export function AgentThreadsPage() {
  const [threads, setThreads] = useState([]);
  const [openKey, setOpenKey] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api("/api/agent-messages/threads?limit=40");
      setThreads(data.threads || []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 12_000);
    return () => window.clearInterval(t);
  }, [load]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Agent threads</h1>
        <p className="text-sm text-teal-900/70">
          Conversations between agents via <code className="text-xs">message_agent</code> (task,
          question, approval, handoff, event).
        </p>
      </div>

      <PageGuideBanner helpId="nav.agentThreads" />

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}

      {loading && !threads.length ? (
        <p className="text-sm text-teal-900/60">Loading threads…</p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {threads.map((th) => {
          const open = openKey === th.conversationKey;
          return (
            <li
              key={th.conversationKey}
              className="overflow-hidden rounded-2xl border border-teal-100 bg-white shadow-sm"
            >
              <button
                type="button"
                onClick={() =>
                  setOpenKey((k) => (k === th.conversationKey ? "" : th.conversationKey))
                }
                className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-teal-50/60"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-teal-950">{participantsLabel(th)}</span>
                  {(th.modes || []).map((m) => (
                    <span
                      key={m}
                      className="rounded-md bg-teal-50 px-1.5 py-0.5 text-xs font-mono text-teal-800"
                    >
                      {m}
                    </span>
                  ))}
                  <span className="text-xs text-teal-900/50">
                    hop {th.hopDepth}/2 · {th.messageCount} msg
                  </span>
                </div>
                <div className="line-clamp-2 text-sm text-teal-900/75">{th.preview || "(empty)"}</div>
                <div className="text-xs text-teal-900/45">
                  {th.updatedAt ? new Date(th.updatedAt).toLocaleString() : ""} ·{" "}
                  {th.lastStatus || "—"}
                </div>
              </button>
              {open ? (
                <div className="border-t border-teal-50 bg-teal-50/30 px-4 py-3">
                  <ul className="flex flex-col gap-2">
                    {(th.messages || []).map((m) => (
                      <li
                        key={m.id}
                        className="rounded-xl border border-teal-100/80 bg-white px-3 py-2 text-sm"
                      >
                        <div className="flex flex-wrap gap-2 text-xs font-semibold text-teal-900">
                          <span>
                            {m.fromAgent?.name || "?"} → {m.toAgent?.name || "?"}
                          </span>
                          <span className="font-mono text-teal-700">{m.type}</span>
                          <span className="font-normal text-teal-900/50">{m.status}</span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-teal-950/85">
                          {(m.resultSummary || m.content || "").slice(0, 1200)}
                        </p>
                        <div className="mt-1 text-[0.7rem] text-teal-900/40">
                          {m.createdAt ? new Date(m.createdAt).toLocaleString() : ""}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-teal-900/50">
                    Also on{" "}
                    <Link to="/operations" className="font-semibold text-teal-800 underline">
                      Operations → Agent hops
                    </Link>{" "}
                    and Events (<span className="font-mono">agent.message.*</span>).
                  </p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {!loading && !threads.length ? (
        <p className="rounded-2xl border border-dashed border-teal-200 bg-white p-6 text-sm text-teal-900/65">
          No agent-to-agent threads yet. In a chat, ask an agent to use{" "}
          <code className="text-xs">message_agent</code> toward a peer.
        </p>
      ) : null}
    </div>
  );
}
