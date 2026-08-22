/**
 * @fileoverview Governance dashboard — audit log and LLM usage (Layer 5).
 * Purpose: Review who did what and estimated token/cost spend across agents.
 */

import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";

export function GovernancePage() {
  const [usage, setUsage] = useState(null);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [usageData, auditData] = await Promise.all([
          api("/api/governance/usage?days=30"),
          api("/api/governance/audit?limit=80"),
        ]);
        setUsage(usageData);
        setEvents(auditData.events || []);
      } catch (err) {
        setError(err);
      }
    })();
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Governance</h1>
        <p className="text-sm text-teal-900/70">
          Audit trail and LLM usage for the last 30 days (Layer 5).
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

      {usage ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Tasks completed", usage.summary?.tasks ?? 0],
            ["LLM calls", usage.summary?.llmCalls ?? 0],
            ["Total tokens", (usage.summary?.totalTokens ?? 0).toLocaleString()],
            ["Est. cost (USD)", `$${(usage.summary?.estimatedUsd ?? 0).toFixed(4)}`],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm"
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-teal-800/60">
                {label}
              </div>
              <div className="mt-1 text-2xl font-bold text-teal-950">{value}</div>
            </div>
          ))}
        </div>
      ) : null}

      {usage?.byAgent?.length ? (
        <div className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-teal-900/80">Usage by agent</h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {usage.byAgent.map((row) => (
              <li key={row.agentId || "none"} className="flex justify-between gap-2 border-b border-teal-50 py-1">
                <span className="truncate font-mono text-xs">{row.agentId?.slice(-8) || "—"}</span>
                <span>
                  {(row.totalTokens || 0).toLocaleString()} tok · ${(row.estimatedUsd || 0).toFixed(4)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-teal-900/80">Audit log</h2>
        <ul className="mt-2 max-h-[28rem] overflow-y-auto text-sm">
          {events.length === 0 ? (
            <li className="text-teal-900/60">No events yet.</li>
          ) : (
            events.map((ev) => (
              <li
                key={ev._id}
                className="border-b border-teal-50 py-2 last:border-0"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                    {ev.action}
                  </span>
                  <span className="text-xs text-teal-900/50">
                    {ev.createdAt ? new Date(ev.createdAt).toLocaleString() : ""}
                  </span>
                </div>
                {ev.detail ? <div className="mt-0.5 text-teal-900/80">{ev.detail}</div> : null}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
