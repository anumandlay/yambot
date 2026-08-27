/**
 * @fileoverview Create / edit a durable goal (Employee OS / Layer 1).
 * Purpose: Title, instructions, KPIs, priority, parent goal, assigned agent.
 */

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import {
  ButtonWithHelp,
  FieldLabel,
  PageGuideBanner,
  SectionTitle,
} from "../components/FieldLabel.jsx";
import { OutcomeBranchesEditor, sanitizeOutcomeBranchesForSave } from "../components/OutcomeBranchesEditor.jsx";
import {
  CompletionActionsEditor,
  sanitizeCompletionActionsForSave,
} from "../components/CompletionActionsEditor.jsx";

const EMPTY_ACTION = {
  label: "",
  runOn: "success",
  when: "",
  kind: "instruction",
  agentId: "",
  goalId: "",
  instructions: "",
};

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
  autonomy: { enabled: false, checkIntervalMinutes: 60, autoRun: true },
  sla: { responseMinutes: 0, name: "" },
  completionEventType: "",
  completionEventOnFailure: "",
  outcomeRoutingEnabled: false,
  outcomeBranches: [{ label: "", eventType: "", description: "" }],
  completionActionsEnabled: false,
  completionActionsPickMode: "rules",
  completionActions: [{ ...EMPTY_ACTION }],
  group: "",
};

export function GoalEditPage() {
  const { goalId } = useParams();
  const isNew = !goalId || goalId === "new";
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [agents, setAgents] = useState([]);
  const [goals, setGoals] = useState([]);
  const [goalGroups, setGoalGroups] = useState([]);
  const [statuses, setStatuses] = useState(["active", "paused", "completed", "archived"]);
  const [priorities, setPriorities] = useState(["low", "normal", "high", "urgent"]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [okMsg, setOkMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [meta, agentData, goalListData, groupData] = await Promise.all([
          api("/api/goals/meta"),
          api("/api/agents"),
          api("/api/goals"),
          api("/api/groups?type=goal"),
        ]);
        if (Array.isArray(meta.statuses)) setStatuses(meta.statuses);
        if (Array.isArray(meta.priorities)) setPriorities(meta.priorities);
        setAgents(agentData.agents || []);
        setGoalGroups(groupData.groups || []);
        setGoals((goalListData.goals || []).filter((g) => String(g._id) !== String(goalId)));
        if (!isNew) {
          const one = await api(`/api/goals/${goalId}`);
          const g = one.goal;
          setForm({
            title: g.title || "",
            group: g.group ? String(g.group) : "",
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
            autonomy: {
              enabled: g.autonomy?.enabled === true,
              checkIntervalMinutes: Number(g.autonomy?.checkIntervalMinutes) || 60,
              autoRun: g.autonomy?.autoRun !== false,
            },
            sla: {
              responseMinutes: Number(g.sla?.responseMinutes) || 0,
              name: g.sla?.name || "",
            },
            completionEventType: g.completionEventType || "",
            completionEventOnFailure: g.completionEventOnFailure || "",
            outcomeRoutingEnabled: Boolean(g.outcomeRoutingEnabled),
            outcomeBranches: g.outcomeBranches?.length
              ? g.outcomeBranches.map((b) => ({
                  label: b.label || "",
                  eventType: b.eventType || "",
                  description: b.description || "",
                }))
              : [{ label: "", eventType: "", description: "" }],
            completionActionsEnabled: Boolean(g.completionActionsEnabled),
            completionActionsPickMode: g.completionActionsPickMode === "llm" ? "llm" : "rules",
            completionActions: g.completionActions?.length
              ? g.completionActions.map((a) => ({
                  label: a.label || "",
                  runOn: a.runOn || "success",
                  when: a.when || "",
                  kind: a.kind === "goal" ? "goal" : "instruction",
                  agentId: a.agentId ? String(a.agentId) : "",
                  goalId: a.goalId ? String(a.goalId) : "",
                  instructions: a.instructions || "",
                }))
              : [{ ...EMPTY_ACTION }],
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
      group: form.group || null,
      kpis: form.kpis
        .filter((k) => k.name.trim())
        .map((k) => ({
          name: k.name.trim(),
          target: k.target === "" ? null : Number(k.target),
          current: Number(k.current) || 0,
          unit: k.unit.trim(),
        })),
      autonomy: form.autonomy,
      sla: form.sla,
      outcomeRoutingEnabled: form.outcomeRoutingEnabled,
      outcomeBranches: sanitizeOutcomeBranchesForSave(form.outcomeBranches),
      completionActionsEnabled: form.completionActionsEnabled,
      completionActionsPickMode: form.completionActionsPickMode,
      completionActions: sanitizeCompletionActionsForSave(form.completionActions),
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
      <PageGuideBanner helpId="goals.page" />

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
          <FieldLabel helpId="goal.title" required>
            Title
          </FieldLabel>
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="goal.group">Group</FieldLabel>
          <select
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.group}
            onChange={(e) => update("group", e.target.value)}
          >
            <option value="">No group</option>
            {goalGroups.map((g) => (
              <option key={g._id} value={g._id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="goal.agent">Assigned agent</FieldLabel>
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
          <FieldLabel helpId="goal.parent">Parent goal (delegation)</FieldLabel>
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
            <FieldLabel helpId="goal.status">Status</FieldLabel>
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
            <FieldLabel helpId="goal.priority">Priority</FieldLabel>
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
          <FieldLabel helpId="goal.description">Description</FieldLabel>
          <textarea
            className="min-h-20 rounded-xl border border-teal-100 px-3 py-2"
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="goal.instructions">Instructions (sent to worker on Run)</FieldLabel>
          <textarea
            className="min-h-28 rounded-xl border border-teal-100 px-3 py-2"
            value={form.instructions}
            onChange={(e) => update("instructions", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="goal.successCriteria">Success criteria</FieldLabel>
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
              <label className="flex flex-col gap-1 text-sm">
                <FieldLabel helpId="goal.kpi.name">Name</FieldLabel>
                <input
                  className="min-h-10 rounded-lg border border-teal-100 px-2 text-sm"
                  value={k.name}
                  onChange={(e) => updateKpi(i, "name", e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <FieldLabel helpId="goal.kpi.target">Target</FieldLabel>
                <input
                  className="min-h-10 rounded-lg border border-teal-100 px-2 text-sm"
                  type="number"
                  value={k.target}
                  onChange={(e) => updateKpi(i, "target", e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <FieldLabel helpId="goal.kpi.current">Current</FieldLabel>
                <input
                  className="min-h-10 rounded-lg border border-teal-100 px-2 text-sm"
                  type="number"
                  value={k.current}
                  onChange={(e) => updateKpi(i, "current", e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <FieldLabel helpId="goal.kpi.unit">Unit</FieldLabel>
                <input
                  className="min-h-10 rounded-lg border border-teal-100 px-2 text-sm"
                  value={k.unit}
                  onChange={(e) => updateKpi(i, "unit", e.target.value)}
                />
              </label>
            </div>
          ))}
          <ButtonWithHelp helpId="goal.kpi.add">
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
          </ButtonWithHelp>
        </div>

        <div className="flex flex-col gap-2 rounded-xl border border-teal-50 bg-teal-50/20 p-3">
          <SectionTitle helpId="goal.autonomy.enabled" className="text-teal-900/80">
            Goal autonomy
          </SectionTitle>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.autonomy.enabled}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  autonomy: { ...prev.autonomy, enabled: e.target.checked },
                }))
              }
            />
            <FieldLabel helpId="goal.autonomy.enabled">
              Periodically self-assess KPIs and spawn tasks
            </FieldLabel>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="goal.autonomy.interval">Check interval (minutes)</FieldLabel>
            <input
              type="number"
              min={1}
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              value={form.autonomy.checkIntervalMinutes}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  autonomy: { ...prev.autonomy, checkIntervalMinutes: e.target.value },
                }))
              }
            />
          </label>
        </div>

        <div className="flex flex-col gap-2 rounded-xl border border-teal-50 bg-teal-50/20 p-3">
          <SectionTitle helpId="goal.sla.name" className="text-teal-900/80">
            SLA
          </SectionTitle>
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="goal.sla.name">SLA name</FieldLabel>
            <input
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              value={form.sla.name}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, sla: { ...prev.sla, name: e.target.value } }))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="goal.sla.responseMinutes">
              Response target (minutes, 0 = none)
            </FieldLabel>
            <input
              type="number"
              min={0}
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              value={form.sla.responseMinutes}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  sla: { ...prev.sla, responseMinutes: e.target.value },
                }))
              }
            />
          </label>
        </div>

        <div className="flex flex-col gap-2 rounded-xl border border-violet-100 bg-violet-50/30 p-3">
          <SectionTitle helpId="goal.completionEventType" className="text-teal-900/80">
            Completion events (triggers)
          </SectionTitle>
          <p className="text-xs text-teal-900/60">
            When this goal&apos;s run finishes, YamBot can emit a custom event on the Operations bus.
            Triggers listen for that type (e.g. <code className="font-mono">crm.aanya.found</code>).
          </p>
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="goal.completionEventType">On success — event type</FieldLabel>
            <input
              className="min-h-11 rounded-xl border border-teal-100 px-3 font-mono text-sm"
              value={form.completionEventType}
              onChange={(e) => update("completionEventType", e.target.value)}
              placeholder="crm.aanya.found"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="goal.completionEventOnFailure">On failure — event type (optional)</FieldLabel>
            <input
              className="min-h-11 rounded-xl border border-teal-100 px-3 font-mono text-sm"
              value={form.completionEventOnFailure}
              onChange={(e) => update("completionEventOnFailure", e.target.value)}
              placeholder="crm.aanya.not_found"
            />
          </label>
        </div>

        <OutcomeBranchesEditor
          enabled={form.outcomeRoutingEnabled}
          onEnabledChange={(v) => update("outcomeRoutingEnabled", v)}
          branches={form.outcomeBranches}
          onBranchesChange={(branches) => update("outcomeBranches", branches)}
          helpIdEnabled="goal.outcomeRouting"
          helpIdBranch="goal.outcomeBranch"
        />

        <CompletionActionsEditor
          enabled={form.completionActionsEnabled}
          onEnabledChange={(v) => update("completionActionsEnabled", v)}
          pickMode={form.completionActionsPickMode}
          onPickModeChange={(v) => update("completionActionsPickMode", v)}
          actions={form.completionActions}
          onActionsChange={(actions) => update("completionActions", actions)}
          agents={agents}
          goals={goals}
          helpIdEnabled="goal.completionActions"
          helpIdAction="goal.completionAction"
        />

        <ButtonWithHelp helpId="goal.save">
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : isNew ? "Create goal" : "Save goal"}
          </button>
        </ButtonWithHelp>
      </form>
    </div>
  );
}
