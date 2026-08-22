/**
 * @fileoverview Goals list — durable objectives (Employee OS / Layer 1).
 * Purpose: Create, run, and track agent goals with KPIs and priority.
 */

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";

export function GoalsPage() {
  const [goals, setGoals] = useState([]);
  const [agents, setAgents] = useState([]);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState("");
  const navigate = useNavigate();

  async function load() {
    try {
      const [goalData, agentData] = await Promise.all([api("/api/goals"), api("/api/agents")]);
      setGoals(goalData.goals || []);
      setAgents(agentData.agents || []);
    } catch (err) {
      setError(err);
    }
  }

  useEffect(() => {
    load();
  }, []);

  /**
   * @param {string} goalId
   */
  async function runGoal(goalId) {
    setBusyId(goalId);
    setError(null);
    try {
      const data = await api(`/api/goals/${goalId}/run`, { method: "POST", body: JSON.stringify({}) });
      if (data.chatId) navigate(`/chats/${data.chatId}`);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusyId("");
    }
  }

  /**
   * @param {object} goal
   */
  function agentName(goal) {
    const a = agents.find((x) => String(x._id) === String(goal.agent));
    return a?.name || "—";
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6 lg:max-w-4xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Goals</h1>
          <p className="text-sm text-teal-900/70">
            Durable objectives with success criteria and KPIs — run on an agent&apos;s cloud computer.
          </p>
        </div>
        <Link
          to="/goals/new"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-teal-700 px-4 font-semibold text-white sm:w-auto"
        >
          New goal
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
        {goals.length === 0 ? (
          <li className="rounded-2xl border border-dashed border-teal-200 bg-white/70 p-6 text-sm text-teal-900/70">
            No goals yet. Create one and assign an agent to run it.
          </li>
        ) : (
          goals.map((g) => (
            <li
              key={g._id}
              className="flex flex-col gap-3 rounded-2xl border border-teal-100 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-4"
            >
              <div className="min-w-0">
                <div className="truncate font-semibold">{g.title}</div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-teal-800/60">
                  <span className="rounded bg-teal-50 px-1.5 py-0.5 uppercase">{g.status}</span>
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 uppercase text-amber-900">
                    {g.priority}
                  </span>
                  <span>Agent: {agentName(g)}</span>
                  <span>
                    Runs: {g.stats?.runs || 0} ({g.stats?.successes || 0} ok)
                  </span>
                </div>
                {g.description ? (
                  <p className="mt-1 line-clamp-2 text-sm text-teal-900/70">{g.description}</p>
                ) : null}
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <Link
                  to={`/goals/${g._id}`}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-teal-100 px-3 text-sm font-semibold"
                >
                  Edit
                </Link>
                <button
                  type="button"
                  disabled={Boolean(busyId) || !g.agent || g.status === "archived"}
                  onClick={() => runGoal(g._id)}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl bg-teal-700 px-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busyId === g._id ? "Running…" : "Run now"}
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
