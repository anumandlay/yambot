/**
 * @fileoverview Agents list — create and open specialized browser agents.
 * Purpose: Entry point for managing agent profiles/skills/instructions.
 */

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";

export function AgentsPage() {
  const [agents, setAgents] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function load() {
    try {
      const data = await api("/api/agents");
      setAgents(data.agents || []);
    } catch (err) {
      setError(err);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function startChat(agentId) {
    setBusy(true);
    setError(null);
    try {
      const data = await api("/api/chats", {
        method: "POST",
        body: JSON.stringify({ agentId }),
      });
      navigate(`/chats/${data.chat._id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 md:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
          <p className="text-sm text-teal-900/70">
            Each agent has a profile, skill, instructions, facts, and autonomy rules.
          </p>
        </div>
        <Link
          to="/agents/new"
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-teal-700 px-4 font-semibold text-white"
        >
          New agent
        </Link>
      </div>

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}

      <ul className="flex flex-col gap-2">
        {agents.length === 0 ? (
          <li className="rounded-2xl border border-dashed border-teal-200 bg-white/70 p-6 text-sm text-teal-900/70">
            No agents yet. Create one, then start a chat with it.
          </li>
        ) : (
          agents.map((a) => (
            <li
              key={a._id}
              className="flex flex-col gap-3 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <div className="font-semibold">{a.name}</div>
                <div className="text-xs uppercase tracking-wide text-teal-800/60">{a.skill}</div>
                {a.description ? (
                  <p className="mt-1 text-sm text-teal-900/70">{a.description}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  to={`/agents/${a._id}`}
                  className="inline-flex min-h-11 items-center rounded-xl border border-teal-100 px-3 text-sm font-semibold"
                >
                  Edit
                </Link>
                <button
                  type="button"
                  disabled={busy || a.active === false}
                  onClick={() => startChat(a._id)}
                  className="inline-flex min-h-11 items-center rounded-xl bg-teal-700 px-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Start chat
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
