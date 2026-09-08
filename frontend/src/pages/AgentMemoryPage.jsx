/**
 * @fileoverview Agent memory viewer — read the notes an agent keeps between runs.
 * Purpose: Dedicated page so operators can inspect agent.memory without the editor.
 * Downstream: GET /api/agents/:id/memory.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";

const KIND_LABEL = {
  note: "Note",
  run: "From a run",
  avoid: "Avoid",
  preference: "Preference",
};

/**
 * @param {string|Date|null|undefined} d
 * @returns {string}
 */
function fmtWhen(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString();
  } catch {
    return "—";
  }
}

/**
 * Read-only list of one agent's long-term memory.
 */
export function AgentMemoryPage() {
  const { agentId } = useParams();
  const [agentName, setAgentName] = useState("");
  const [memory, setMemory] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    if (!agentId) return;
    setBusy(true);
    try {
      const data = await api(`/api/agents/${agentId}/memory`);
      setAgentName(data.agent?.name || "Agent");
      setMemory(data.memory || []);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [agentId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/agents"
          className="inline-flex min-h-11 items-center rounded-xl border border-teal-100 bg-white px-3 text-sm font-semibold"
        >
          ← Agents
        </Link>
        {agentId ? (
          <Link
            to={`/agents/${agentId}`}
            className="inline-flex min-h-11 items-center rounded-xl border border-teal-100 bg-white px-3 text-sm font-semibold"
          >
            Edit agent
          </Link>
        ) : null}
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
          Memory{agentName ? ` — ${agentName}` : ""}
        </h1>
      </div>

      <p className="text-sm text-teal-900/70">
        These are the notes this agent keeps between runs (newest first). The worker uses them so it
        does not repeat work.
      </p>

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}

      {busy ? (
        <p className="text-sm text-teal-900/70">Loading memory…</p>
      ) : memory.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-teal-200 bg-white/70 p-6 text-sm text-teal-900/70">
          No memories yet. Notes appear after runs, or you can add one on the agent editor.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          <li className="text-xs font-semibold uppercase tracking-wide text-teal-800/60">
            {memory.length} {memory.length === 1 ? "entry" : "entries"}
          </li>
          {memory.map((m, i) => (
            <li
              key={m.id || `${i}-${m.at || ""}`}
              className="rounded-2xl border border-teal-100 bg-white p-3 shadow-sm sm:p-4"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-lg bg-teal-50 px-2 py-1 font-bold uppercase tracking-wide text-teal-800">
                  {KIND_LABEL[m.kind] || m.kind || "note"}
                </span>
                <span className="text-teal-900/60">{fmtWhen(m.at)}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-teal-950">
                {m.content || "—"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
