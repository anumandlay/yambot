/**
 * @fileoverview Agents list — create, open, and delete specialized browser agents.
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
  const [deletingId, setDeletingId] = useState("");
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

  /**
   * @param {object} agent
   */
  async function deleteAgent(agent) {
    const label = agent.name || agent._id;
    if (
      !window.confirm(
        `Delete agent “${label}”? Its cloud computer container will be stopped and removed.`
      )
    ) {
      return;
    }
    setDeletingId(agent._id);
    setError(null);
    try {
      await api(`/api/agents/${agent._id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setDeletingId("");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6 lg:max-w-4xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Agents</h1>
          <p className="text-sm text-teal-900/70">
            Creating an agent provisions its own cloud Chromium box on the VPS. Watch and take
            control of the live screen from the agent page or any chat.
          </p>
        </div>
        <Link
          to="/agents/new"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-teal-700 px-4 font-semibold text-white sm:w-auto"
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
              className="flex flex-col gap-3 rounded-2xl border border-teal-100 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-4"
            >
              <div className="min-w-0">
                <div className="truncate font-semibold">{a.name}</div>
                <div className="flex flex-wrap gap-2 text-xs uppercase tracking-wide text-teal-800/60">
                  {a.skill ? <span className="normal-case">{a.skill}</span> : null}
                  {a.skill ? <span>·</span> : null}
                  <span>
                    {a.runner === "cloud"
                      ? "cloud computer"
                      : a.runner === "extension"
                        ? "chrome only"
                        : "any runner"}
                  </span>
                  {a.schedule?.enabled ? (
                    <>
                      <span>·</span>
                      <span className="text-amber-800">scheduled {a.schedule.interval}</span>
                    </>
                  ) : null}
                  {a.email?.configured || a.email?.enabled ? (
                    <>
                      <span>·</span>
                      <span className="normal-case text-sky-800">
                        {a.email?.fromAddress || "email"}
                      </span>
                    </>
                  ) : null}
                  {a.runner === "cloud" || a.runner === "any" ? (
                    <>
                      <span>·</span>
                      <span className={a.computer?.online ? "text-emerald-700" : ""}>
                        {a.computer?.online ? "online" : "offline"}
                      </span>
                    </>
                  ) : null}
                </div>
                {a.description ? (
                  <p className="mt-1 break-words text-sm text-teal-900/70">{a.description}</p>
                ) : null}
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
                <Link
                  to={`/agents/${a._id}`}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-teal-100 px-3 text-sm font-semibold sm:w-auto"
                >
                  Edit
                </Link>
                <button
                  type="button"
                  disabled={busy || a.active === false}
                  onClick={() => startChat(a._id)}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-teal-700 px-3 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto"
                >
                  Start chat
                </button>
                <button
                  type="button"
                  disabled={Boolean(deletingId)}
                  onClick={() => deleteAgent(a)}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 disabled:opacity-50 sm:w-auto"
                >
                  {deletingId === a._id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
