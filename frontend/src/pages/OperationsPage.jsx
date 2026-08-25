/**
 * @fileoverview Operations dashboard — event bus, triggers, watchers.
 * Purpose: Monitor company events and configure reactive automation (AI Workforce OS).
 * Downstream: `/api/events`, `/api/triggers`, `/api/watchers`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { ButtonWithHelp, FieldLabel, PageGuideBanner } from "../components/FieldLabel.jsx";

export function OperationsPage() {
  const [tab, setTab] = useState("events");
  const [events, setEvents] = useState([]);
  const [triggers, setTriggers] = useState([]);
  const [watchers, setWatchers] = useState([]);
  const [agents, setAgents] = useState([]);
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState("");
  const [emitType, setEmitType] = useState("user.note");
  const [emitSummary, setEmitSummary] = useState("");
  const [triggerName, setTriggerName] = useState("");
  const [triggerEventType, setTriggerEventType] = useState("crm.aanya.found");
  const [triggerAgentId, setTriggerAgentId] = useState("");
  const [triggerTaskText, setTriggerTaskText] = useState(
    "Log out of CRM (click Logout / Sign out and confirm you are logged out)."
  );
  const [triggerCompletionEvent, setTriggerCompletionEvent] = useState("crm.logout.done");
  const [editingTriggerId, setEditingTriggerId] = useState(null);
  const [watcherUrl, setWatcherUrl] = useState("");
  const [watcherAgentId, setWatcherAgentId] = useState("");

  const load = useCallback(async () => {
    const [ev, tr, wa, agentData] = await Promise.all([
      api("/api/events?limit=40"),
      api("/api/triggers"),
      api("/api/watchers"),
      api("/api/agents"),
    ]);
    setEvents(ev.events || []);
    setTriggers(tr.triggers || []);
    setWatchers(wa.watchers || []);
    setAgents(agentData.agents || []);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err));
  }, [load]);

  useEffect(() => {
    if (!agents.length) return;
    setTriggerAgentId((prev) => prev || String(agents[0]._id));
    setWatcherAgentId((prev) => prev || String(agents[0]._id));
  }, [agents]);

  const agentNameById = useMemo(() => {
    const map = new Map();
    for (const a of agents) map.set(String(a._id), a.name || a._id);
    return map;
  }, [agents]);

  function resetTriggerForm() {
    setEditingTriggerId(null);
    setTriggerName("");
    setTriggerEventType("crm.aanya.found");
    setTriggerTaskText(
      "Log out of CRM (click Logout / Sign out and confirm you are logged out)."
    );
    setTriggerCompletionEvent("crm.logout.done");
    if (agents.length) setTriggerAgentId(String(agents[0]._id));
  }

  function startEditTrigger(trigger) {
    setError(null);
    setOkMsg("");
    setEditingTriggerId(String(trigger._id));
    setTriggerName(trigger.name || "");
    setTriggerEventType(trigger.config?.eventType || "");
    setTriggerAgentId(trigger.agent ? String(trigger.agent) : "");
    setTriggerTaskText(trigger.actionConfig?.instructions || "");
    setTriggerCompletionEvent(trigger.completionEventType || "");
    setTab("triggers");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveTrigger(e) {
    e.preventDefault();
    setError(null);
    setOkMsg("");
    if (!triggerAgentId) {
      setError({ title: "Agent required", detail: "Pick which agent runs the follow-up task." });
      return;
    }
    const payload = {
      name: triggerName.trim() || "Event trigger",
      type: "event",
      action: "enqueue_task",
      agentId: triggerAgentId,
      actionConfig: {
        instructions: triggerTaskText.trim() || "Respond to event",
      },
      config: { eventType: triggerEventType.trim() || "user.note" },
      completionEventType: triggerCompletionEvent.trim(),
    };
    try {
      if (editingTriggerId) {
        await api(`/api/triggers/${editingTriggerId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        resetTriggerForm();
        setOkMsg("Trigger updated.");
      } else {
        await api("/api/triggers", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setTriggerName("");
        setOkMsg(
          triggerCompletionEvent.trim()
            ? "Trigger created — when its task completes, it will emit your completion event."
            : "Trigger created — it will enqueue a task when the event type matches."
        );
      }
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function deleteTrigger(id) {
    if (!window.confirm("Delete this trigger?")) return;
    setError(null);
    if (editingTriggerId === String(id)) resetTriggerForm();
    try {
      await api(`/api/triggers/${id}`, { method: "DELETE" });
      setOkMsg("Trigger deleted.");
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function createWatcher(e) {
    e.preventDefault();
    setError(null);
    setOkMsg("");
    const target = watcherUrl.trim();
    if (!target || !watcherAgentId) {
      setError({ title: "Missing fields", detail: "Pick an agent and enter a URL to watch." });
      return;
    }
    try {
      await api("/api/watchers", {
        method: "POST",
        body: JSON.stringify({
          name: target,
          agentId: watcherAgentId,
          target,
          targetType: "url",
          intervalMinutes: 30,
        }),
      });
      setWatcherUrl("");
      setOkMsg("Watcher created.");
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function emitEvent(e) {
    e.preventDefault();
    setError(null);
    setOkMsg("");
    try {
      await api("/api/events/emit", {
        method: "POST",
        body: JSON.stringify({ type: emitType.trim(), summary: emitSummary.trim() }),
      });
      setEmitSummary("");
      setOkMsg("Event emitted.");
      await load();
    } catch (err) {
      setError(err);
    }
  }

  const tabs = [
    ["events", "Events"],
    ["triggers", "Triggers"],
    ["watchers", "Watchers"],
  ];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Operations</h1>
        <p className="text-sm text-teal-900/70">
          Company event bus, automation triggers, and URL watchers.
        </p>
      </div>

      <PageGuideBanner helpId="ops.page" />

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}
      {okMsg ? <p className="text-sm font-semibold text-teal-800">{okMsg}</p> : null}

      <div className="flex flex-wrap gap-2">
        {tabs.map(([id, label]) => (
          <ButtonWithHelp key={id} helpId={`ops.${id}`}>
            <button
              type="button"
              onClick={() => setTab(id)}
              className={`min-h-10 rounded-xl px-3 text-sm font-semibold ${
                tab === id ? "bg-teal-700 text-white" : "border border-teal-100 bg-white text-teal-900"
              }`}
            >
              {label}
            </button>
          </ButtonWithHelp>
        ))}
      </div>

      {tab === "events" ? (
        <div className="flex flex-col gap-3">
          <form
            onSubmit={emitEvent}
            className="flex flex-col gap-2 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm sm:flex-row sm:items-end"
          >
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <FieldLabel helpId="ops.emitType">Type</FieldLabel>
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3 font-mono text-sm"
                value={emitType}
                onChange={(e) => setEmitType(e.target.value)}
              />
            </label>
            <label className="flex flex-[2] flex-col gap-1 text-sm">
              <FieldLabel helpId="ops.emitSummary">Summary</FieldLabel>
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                value={emitSummary}
                onChange={(e) => setEmitSummary(e.target.value)}
                placeholder="What happened?"
              />
            </label>
            <ButtonWithHelp helpId="ops.emit">
              <button type="submit" className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white">
                Emit
              </button>
            </ButtonWithHelp>
          </form>
          <ul className="flex flex-col gap-2">
            {events.map((ev) => (
              <li key={ev._id} className="rounded-xl border border-teal-100 bg-white p-3 text-sm">
                <div className="font-semibold font-mono text-teal-900">{ev.type}</div>
                <div className="text-teal-900/70">{ev.summary || "(no summary)"}</div>
                <div className="text-xs text-teal-900/50">
                  {ev.source} · {ev.createdAt ? new Date(ev.createdAt).toLocaleString() : ""}
                </div>
              </li>
            ))}
            {!events.length ? <p className="text-sm text-teal-900/60">No events yet.</p> : null}
          </ul>
        </div>
      ) : null}

      {tab === "triggers" ? (
        <div className="flex flex-col gap-3">
          <form
            onSubmit={saveTrigger}
            className={`flex flex-col gap-3 rounded-2xl border bg-white p-4 shadow-sm ${
              editingTriggerId ? "border-teal-400 ring-2 ring-teal-200" : "border-teal-100"
            }`}
          >
            <h2 className="text-sm font-semibold text-teal-900/80">
              {editingTriggerId ? "Edit trigger" : "When event → run agent task"}
            </h2>
            <label className="flex flex-col gap-1 text-sm">
              <FieldLabel helpId="ops.triggerName">Trigger name</FieldLabel>
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                value={triggerName}
                onChange={(e) => setTriggerName(e.target.value)}
                placeholder="e.g. Log out after Aanya found"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <FieldLabel helpId="ops.triggerEventType">Listen for event type (IF)</FieldLabel>
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3 font-mono text-sm"
                value={triggerEventType}
                onChange={(e) => setTriggerEventType(e.target.value)}
                placeholder="crm.aanya.found"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <FieldLabel helpId="ops.triggerAgent">Run on agent (THEN)</FieldLabel>
              <select
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                value={triggerAgentId}
                onChange={(e) => setTriggerAgentId(e.target.value)}
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
              <FieldLabel helpId="ops.triggerTask">Task instructions for agent</FieldLabel>
              <textarea
                className="min-h-20 rounded-xl border border-teal-100 px-3 py-2 text-sm"
                value={triggerTaskText}
                onChange={(e) => setTriggerTaskText(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <FieldLabel helpId="ops.triggerCompletionEvent">
                On task success — emit event type (optional)
              </FieldLabel>
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3 font-mono text-sm"
                value={triggerCompletionEvent}
                onChange={(e) => setTriggerCompletionEvent(e.target.value)}
                placeholder="crm.logout.done"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <ButtonWithHelp helpId="ops.triggerAdd">
                <button
                  type="submit"
                  className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white"
                >
                  {editingTriggerId ? "Save changes" : "Add trigger"}
                </button>
              </ButtonWithHelp>
              {editingTriggerId ? (
                <button
                  type="button"
                  onClick={resetTriggerForm}
                  className="min-h-11 rounded-xl border border-teal-200 bg-white px-4 text-sm font-semibold text-teal-900"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
          <ul className="flex flex-col gap-2">
            {triggers.map((t) => (
              <li
                key={t._id}
                className={`flex flex-col gap-2 rounded-xl border bg-white p-3 text-sm sm:flex-row sm:items-start sm:justify-between ${
                  editingTriggerId === String(t._id)
                    ? "border-teal-400 ring-2 ring-teal-100"
                    : "border-teal-100"
                }`}
              >
                <div className="min-w-0">
                  <div className="font-semibold">{t.name}</div>
                  <div className="mt-1 text-teal-900/70">
                    IF <span className="font-mono">{t.config?.eventType || "?"}</span> → {t.action}
                    {t.agent ? ` on ${agentNameById.get(String(t.agent)) || "agent"}` : " (no agent)"}
                  </div>
                  {t.actionConfig?.instructions ? (
                    <div className="mt-1 line-clamp-2 text-xs text-teal-900/50">
                      Task: {t.actionConfig.instructions}
                    </div>
                  ) : null}
                  {t.completionEventType ? (
                    <div className="mt-1 text-xs text-teal-900/50">
                      On success → emit <span className="font-mono">{t.completionEventType}</span>
                    </div>
                  ) : null}
                  <div className="mt-1 text-xs text-teal-900/40">
                    Fired {t.fireCount || 0}×
                    {t.lastFiredAt ? ` · last ${new Date(t.lastFiredAt).toLocaleString()}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <ButtonWithHelp helpId="ops.triggerEdit">
                    <button
                      type="button"
                      onClick={() => startEditTrigger(t)}
                      className="min-h-10 rounded-xl border border-teal-200 bg-teal-50 px-3 text-xs font-semibold text-teal-800"
                    >
                      Edit
                    </button>
                  </ButtonWithHelp>
                  <button
                    type="button"
                    onClick={() => deleteTrigger(t._id)}
                    className="min-h-10 rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
            {!triggers.length ? (
              <p className="text-sm text-teal-900/60">No triggers yet. Add one above.</p>
            ) : null}
          </ul>
        </div>
      ) : null}

      {tab === "watchers" ? (
        <div className="flex flex-col gap-3">
          <form
            onSubmit={createWatcher}
            className="flex flex-col gap-3 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm sm:flex-row sm:flex-wrap sm:items-end"
          >
            <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm">
              <FieldLabel helpId="ops.watcherAgent">Agent</FieldLabel>
              <select
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                value={watcherAgentId}
                onChange={(e) => setWatcherAgentId(e.target.value)}
              >
                <option value="">— pick agent —</option>
                {agents.map((a) => (
                  <option key={a._id} value={a._id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-0 flex-[2] flex-col gap-1 text-sm">
              <FieldLabel helpId="ops.watcherUrl">URL to watch</FieldLabel>
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3 text-sm"
                value={watcherUrl}
                onChange={(e) => setWatcherUrl(e.target.value)}
                placeholder="https://status.example.com"
              />
            </label>
            <ButtonWithHelp helpId="ops.watcherAdd">
              <button type="submit" className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white">
                Watch
              </button>
            </ButtonWithHelp>
          </form>
          <ul className="flex flex-col gap-2">
            {watchers.map((w) => (
              <li key={w._id} className="rounded-xl border border-teal-100 bg-white p-3 text-sm">
                <div className="font-semibold">{w.name || w.target}</div>
                <div className="truncate text-teal-900/70">{w.target}</div>
                <div className="text-xs text-teal-900/50">
                  every {w.intervalMinutes || 30}m · changes {w.changeCount || 0}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
