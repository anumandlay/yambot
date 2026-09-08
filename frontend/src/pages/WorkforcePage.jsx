/**
 * @fileoverview Workforce dashboard — Layer 3 manager delegation overview.
 * Purpose: Show per-agent workload; delegate child goals from manager-owned parent goals.
 * Downstream: `/api/workforce/overview`, `/api/workforce/delegate`, `/api/goals`.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { ButtonWithHelp, FieldLabel, PageGuideBanner } from "../components/FieldLabel.jsx";

export function WorkforcePage() {
  const [agents, setAgents] = useState([]);
  const [goals, setGoals] = useState([]);
  const [parentGoalId, setParentGoalId] = useState("");
  const [assignAgentId, setAssignAgentId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const [overview, goalsData] = await Promise.all([
      api("/api/workforce/overview"),
      api("/api/goals"),
    ]);
    setAgents(overview.agents || []);
    setGoals(goalsData.goals || []);
  }

  useEffect(() => {
    load().catch((err) => setError(err));
  }, []);

  const managers = agents.filter((a) => a.role === "manager");
  const managerIds = new Set(managers.map((m) => m.id));
  const delegatableGoals = goals.filter((g) => managerIds.has(String(g.agent)));

  async function onDelegate(e) {
    e.preventDefault();
    if (!parentGoalId || !assignAgentId) return;
    setBusy(true);
    setOkMsg("");
    setError(null);
    try {
      const data = await api("/api/workforce/delegate", {
        method: "POST",
        body: JSON.stringify({
          parentGoalId,
          assignments: [{ agentId: assignAgentId, instructions: instructions.trim() || undefined }],
        }),
      });
      setOkMsg(`Created ${data.goals?.length || 0} delegated goal(s).`);
      setInstructions("");
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Workforce</h1>
        <p className="text-sm text-teal-900/70">
          Manager agents delegate child goals to workers they manage (Layer 3).
        </p>
      </div>

      <PageGuideBanner helpId="workforce.page" />

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}
      {okMsg ? <p className="text-sm font-semibold text-teal-800">{okMsg}</p> : null}

      <div className="overflow-x-auto rounded-2xl border border-teal-100 bg-white shadow-sm">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="border-b border-teal-100 bg-teal-50/50 text-xs uppercase text-teal-800/70">
            <tr>
              <th className="px-3 py-2">Agent</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Lifecycle</th>
              <th className="px-3 py-2">Online</th>
              <th className="px-3 py-2">Pending</th>
              <th className="px-3 py-2">Running</th>
              <th className="px-3 py-2">Waiting</th>
            </tr>
          </thead>
          <tbody>
            {agents.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-teal-900/60">
                  No agents yet.
                </td>
              </tr>
            ) : (
              agents.map((a) => (
                <tr key={a.id} className="border-b border-teal-50 last:border-0">
                  <td className="px-3 py-2 font-semibold">
                    <Link to={`/agents/${a.id}`} className="text-teal-800 hover:underline">
                      {a.name}
                    </Link>
                    <Link
                      to={`/agents/${a.id}/memory`}
                      className="ml-2 text-xs font-semibold text-violet-800 hover:underline"
                    >
                      View memory
                    </Link>
                  </td>
                  <td className="px-3 py-2 capitalize">{a.role || "worker"}</td>
                  <td className="px-3 py-2">
                    <select
                      className="min-h-9 rounded-lg border border-teal-100 bg-white px-2 text-xs"
                      value={a.lifecycleStatus || "active"}
                      onChange={(e) =>
                        void (async () => {
                          setError(null);
                          try {
                            await api("/api/workforce/lifecycle", {
                              method: "POST",
                              body: JSON.stringify({
                                agentId: a.id,
                                status: e.target.value,
                              }),
                            });
                            await load();
                          } catch (err) {
                            setError(err);
                          }
                        })()
                      }
                    >
                      <option value="hire">hire</option>
                      <option value="training">training</option>
                      <option value="active">active</option>
                      <option value="paused">paused</option>
                      <option value="retiring">retiring</option>
                      <option value="retired">retired</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">{a.online ? "●" : "○"}</td>
                  <td className="px-3 py-2">{a.workload?.pending ?? 0}</td>
                  <td className="px-3 py-2">{a.workload?.running ?? 0}</td>
                  <td className="px-3 py-2">{a.workload?.waiting ?? 0}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {managers.length > 0 ? (
        <form
          onSubmit={onDelegate}
          className="flex flex-col gap-3 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm"
        >
          <h2 className="text-sm font-semibold text-teal-900/80">Delegate child goal</h2>
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="workforce.parentGoal">
              Parent goal (owned by a manager agent)
            </FieldLabel>
            <select
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              value={parentGoalId}
              onChange={(e) => setParentGoalId(e.target.value)}
            >
              <option value="">Select…</option>
              {delegatableGoals.map((g) => (
                <option key={g._id} value={g._id}>
                  {g.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="workforce.assignAgent">Assign to worker</FieldLabel>
            <select
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              value={assignAgentId}
              onChange={(e) => setAssignAgentId(e.target.value)}
            >
              <option value="">Select…</option>
              {agents
                .filter((a) => a.role !== "manager")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="workforce.instructions">Optional instructions override</FieldLabel>
            <textarea
              className="min-h-20 rounded-xl border border-teal-100 px-3 py-2"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Leave empty to copy parent goal instructions"
            />
          </label>
          <ButtonWithHelp helpId="workforce.delegate">
            <button
              type="submit"
              disabled={busy || !parentGoalId || !assignAgentId}
              className="min-h-11 self-start rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Delegating…" : "Delegate"}
            </button>
          </ButtonWithHelp>
        </form>
      ) : (
        <p className="text-sm text-teal-900/60">
          Set an agent&apos;s role to <strong>manager</strong> and add managed workers on the agent edit page to enable delegation.
        </p>
      )}
    </div>
  );
}
