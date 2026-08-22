/**
 * @fileoverview Create / edit a durable goal (Employee OS / Layer 1).
 * Purpose: Title, instructions, KPIs, priority, parent goal, assigned agent.
 */

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";

const EMPTY = {
  title: "",
  description: "",
  instructions: "",
  successCriteria: "",
  agent: "",
  parentGoal: "",
  status: "active",
  priority: "normal",
  kpis: [{ name: "", target: "", current: "0", unit: "" }],
};

export function GoalEditPage() {
  const { goalId } = useParams();
  const isNew = !goalId || goalId === "new";
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [agents, setAgents] = useState([]);
  const [goals, setGoals] = useState([]);
  const [statuses, setStatuses] = useState(["active", "paused", "completed", "archived"]);
  const [priorities, setPriorities] = useState(["low", "normal", "high", "urgent"]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [okMsg, setOkMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [meta, agentData, goalListData] = await Promise.all([
          api("/api/goals/meta"),
          api("/api/agents"),
          api("/api/goals"),
        ]);
        if (Array.isArray(meta.statuses)) setStatuses(meta.statuses);
        if (Array.isArray(meta.priorities)) setPriorities(meta.priorities);
        setAgents(agentData.agents || []);
        setGoals((goalListData.goals || []).filter((g) => String(g._id) !== String(goalId)));
        if (!isNew) {
          const one = await api(`/api/goals/${goalId}`);
          const g = one.goal;
          setForm({
            title: g.title || "",
            description: g.description || "",
            instructions: g.instructions || "",
            successCriteria: g.successCriteria || "",
            agent: g.agent ? String(g.agent) : "",
            parentGoal: g.parentGoal ? String(g.parentGoal) : "",
            status: g.status || "active",
            priority: g.priority || "normal",
            kpis: g.kpis?.length
              ? g.kpis.map((k) => ({
                  name: k.name || "",
                  target: k.target ?? "",
                  current: String(k.current ?? 0),
                  unit: k.unit || "",
                }))
              : [{ name: "", target: "", current: "0", unit: "" }],
          });
        }
      } catch (err) {
        setError(err);
      }
    })();
  }, [goalId, isNew]);

  /**
   * @param {string} key
   * @param {string} value
   */
  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  /**
   * @param {number} index
   * @param {string} field
   * @param {string} value
   */
  function updateKpi(index, field, value) {
    setForm((prev) => {
      const kpis = [...prev.kpis];
      kpis[index] = { ...kpis[index], [field]: value };
      return { ...prev, kpis };
    });
  }

  /**
   * @param {React.FormEvent} e
   */
  async function onSave(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOkMsg("");
    const payload = {
      ...form,
      agent: form.agent || null,
      parentGoal: form.parentGoal || null,
      kpis: form.kpis
        .filter((k) => k.name.trim())
        .map((k) => ({
          name: k.name.trim(),
          target: k.target === "" ? null : Number(k.target),
          current: Number(k.current) || 0,
          unit: k.unit.trim(),
        })),
    };
    try {
      if (isNew) {
        const data = await api("/api/goals", { method: "POST", body: JSON.stringify(payload) });
        navigate(`/goals/${data.goal._id}`, { replace: true });
      } else {
        await api(`/api/goals/${goalId}`, { method: "PUT", body: JSON.stringify(payload) });
        setOkMsg("Goal saved");
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div className="flex items-center gap-2 text-sm">
        <Link to="/goals" className="font-semibold text-teal-800 underline">
          ← Goals
        </Link>
      </div>
      <h1 className="text-2xl font-bold tracking-tight">{isNew ? "New goal" : "Edit goal"}</h1>

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}
      {okMsg ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {okMsg}
        </div>
      ) : null}

      <form onSubmit={onSave} className="flex flex-col gap-3 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-1 text-sm">
          Title
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Assigned agent
          <select
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.agent}
            onChange={(e) => update("agent", e.target.value)}
          >
            <option value="">— pick agent —</option>
            {agents.map((a) => (
              <option key={a._id} value={a._id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Parent goal (delegation)
          <select
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.parentGoal}
            onChange={(e) => update("parentGoal", e.target.value)}
          >
            <option value="">None</option>
            {goals.map((g) => (
              <option key={g._id} value={g._id}>
                {g.title}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Status
            <select
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              value={form.status}
              onChange={(e) => update("status", e.target.value)}
            >
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Priority
            <select
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              value={form.priority}
              onChange={(e) => update("priority", e.target.value)}
            >
              {priorities.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          Description
          <textarea
            className="min-h-20 rounded-xl border border-teal-100 px-3 py-2"
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Instructions (sent to worker on Run)
          <textarea
            className="min-h-28 rounded-xl border border-teal-100 px-3 py-2"
            value={form.instructions}
            onChange={(e) => update("instructions", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Success criteria
          <textarea
            className="min-h-20 rounded-xl border border-teal-100 px-3 py-2"
            value={form.successCriteria}
            onChange={(e) => update("successCriteria", e.target.value)}
          />
        </label>

        <div className="flex flex-col gap-2">
          <div className="text-sm font-semibold text-teal-900/80">KPIs</div>
          {form.kpis.map((k, i) => (
            <div key={i} className="grid gap-2 rounded-xl border border-teal-50 bg-teal-50/30 p-2 sm:grid-cols-4">
              <input
                className="min-h-10 rounded-lg border border-teal-100 px-2 text-sm"
                placeholder="Name"
                value={k.name}
                onChange={(e) => updateKpi(i, "name", e.target.value)}
              />
              <input
                className="min-h-10 rounded-lg border border-teal-100 px-2 text-sm"
                placeholder="Target"
                type="number"
                value={k.target}
                onChange={(e) => updateKpi(i, "target", e.target.value)}
              />
              <input
                className="min-h-10 rounded-lg border border-teal-100 px-2 text-sm"
                placeholder="Current"
                type="number"
                value={k.current}
                onChange={(e) => updateKpi(i, "current", e.target.value)}
              />
              <input
                className="min-h-10 rounded-lg border border-teal-100 px-2 text-sm"
                placeholder="Unit"
                value={k.unit}
                onChange={(e) => updateKpi(i, "unit", e.target.value)}
              />
            </div>
          ))}
          <button
            type="button"
            className="min-h-10 self-start rounded-xl border border-teal-100 px-3 text-sm font-semibold"
            onClick={() =>
              setForm((prev) => ({
                ...prev,
                kpis: [...prev.kpis, { name: "", target: "", current: "0", unit: "" }],
              }))
            }
          >
            Add KPI
          </button>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : isNew ? "Create goal" : "Save goal"}
        </button>
      </form>
    </div>
  );
}
