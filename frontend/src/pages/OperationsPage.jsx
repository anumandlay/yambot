/**
 * @fileoverview Operations dashboard — event bus, triggers, watchers.
 * Purpose: Monitor company events and configure reactive automation (AI Workforce OS).
 * Downstream: `/api/events`, `/api/triggers`, `/api/watchers`.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";

export function OperationsPage() {
  const [tab, setTab] = useState("events");
  const [events, setEvents] = useState([]);
  const [triggers, setTriggers] = useState([]);
  const [watchers, setWatchers] = useState([]);
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState("");
  const [triggerName, setTriggerName] = useState("");
  const [watcherUrl, setWatcherUrl] = useState("");
  const [emitType, setEmitType] = useState("user.note");
  const [emitSummary, setEmitSummary] = useState("");

  const load = useCallback(async () => {
    const [ev, tr, wa] = await Promise.all([
      api("/api/events?limit=40"),
      api("/api/triggers"),
      api("/api/watchers"),
    ]);
    setEvents(ev.events || []);
    setTriggers(tr.triggers || []);
    setWatchers(wa.watchers || []);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err));
  }, [load]);

  async function createTrigger(e) {
    e.preventDefault();
    setError(null);
    setOkMsg("");
    try {
      await api("/api/triggers", {
        method: "POST",
        body: JSON.stringify({
          name: triggerName.trim() || "Event trigger",
          type: "event",
          action: "enqueue_task",
          actionConfig: { goal: "Respond to event" },
          config: { eventType: "user.note" },
        }),
      });
      setTriggerName("");
      setOkMsg("Trigger created.");
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function createWatcher(e) {
    e.preventDefault();
    setError(null);
    setOkMsg("");
    try {
      await api("/api/watchers", {
        method: "POST",
        body: JSON.stringify({
          name: watcherUrl.trim() || "URL watcher",
          url: watcherUrl.trim(),
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
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`min-h-10 rounded-xl px-3 text-sm font-semibold ${
              tab === id ? "bg-teal-700 text-white" : "border border-teal-100 bg-white text-teal-900"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "events" ? (
        <div className="flex flex-col gap-3">
          <form
            onSubmit={emitEvent}
            className="flex flex-col gap-2 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm sm:flex-row sm:items-end"
          >
            <label className="flex flex-1 flex-col gap-1 text-sm">
              Type
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                value={emitType}
                onChange={(e) => setEmitType(e.target.value)}
              />
            </label>
            <label className="flex flex-[2] flex-col gap-1 text-sm">
              Summary
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                value={emitSummary}
                onChange={(e) => setEmitSummary(e.target.value)}
                placeholder="What happened?"
              />
            </label>
            <button type="submit" className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white">
              Emit
            </button>
          </form>
          <ul className="flex flex-col gap-2">
            {events.map((ev) => (
              <li key={ev._id} className="rounded-xl border border-teal-100 bg-white p-3 text-sm">
                <div className="font-semibold text-teal-900">{ev.type}</div>
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
            onSubmit={createTrigger}
            className="flex gap-2 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm"
          >
            <input
              className="min-h-11 flex-1 rounded-xl border border-teal-100 px-3 text-sm"
              value={triggerName}
              onChange={(e) => setTriggerName(e.target.value)}
              placeholder="Trigger name"
            />
            <button type="submit" className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white">
              Add
            </button>
          </form>
          <ul className="flex flex-col gap-2">
            {triggers.map((t) => (
              <li key={t._id} className="rounded-xl border border-teal-100 bg-white p-3 text-sm">
                <div className="font-semibold">{t.name}</div>
                <div className="text-teal-900/70">
                  {t.type} → {t.action} {t.enabled ? "" : "(disabled)"}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "watchers" ? (
        <div className="flex flex-col gap-3">
          <form
            onSubmit={createWatcher}
            className="flex gap-2 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm"
          >
            <input
              className="min-h-11 flex-1 rounded-xl border border-teal-100 px-3 text-sm"
              value={watcherUrl}
              onChange={(e) => setWatcherUrl(e.target.value)}
              placeholder="https://status.example.com"
            />
            <button type="submit" className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white">
              Watch
            </button>
          </form>
          <ul className="flex flex-col gap-2">
            {watchers.map((w) => (
              <li key={w._id} className="rounded-xl border border-teal-100 bg-white p-3 text-sm">
                <div className="font-semibold">{w.name || w.url}</div>
                <div className="truncate text-teal-900/70">{w.url}</div>
                <div className="text-xs text-teal-900/50">
                  every {w.intervalMinutes || 30}m · last hash {w.lastHash ? "set" : "—"}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
