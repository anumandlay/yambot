/**
 * @fileoverview Governance dashboard — audit log, LLM usage, approvals, budget (Layer 5 + 2).
 * Purpose: Review who did what, estimated spend, pending approvals, and monthly budget cap.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";

export function GovernancePage() {
  const [usage, setUsage] = useState(null);
  const [budget, setBudget] = useState(null);
  const [events, setEvents] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [improvements, setImprovements] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const [usageData, auditData, budgetData, approvalData, perfData, impData] = await Promise.all([
      api("/api/governance/usage?days=30"),
      api("/api/governance/audit?limit=80"),
      api("/api/governance/budget"),
      api("/api/approvals?status=pending"),
      api("/api/governance/performance"),
      api("/api/improvements?status=proposed"),
    ]);
    setUsage(usageData);
    setBudget(budgetData.budget);
    setEvents(auditData.events || []);
    setApprovals(approvalData.approvals || []);
    setReviews(perfData.reviews || []);
    setImprovements(impData.proposals || []);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err));
  }, [load]);

  async function resolveApproval(id, decision) {
    setError(null);
    try {
      await api(`/api/approvals/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function resolveImprovement(id, status) {
    setError(null);
    try {
      await api(`/api/improvements/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Governance</h1>
        <p className="text-sm text-teal-900/70">
          Audit trail, approvals, LLM usage, and monthly budget (Layers 2 & 5).
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

      {budget ? (
        <div className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-teal-900/80">Monthly LLM budget</h2>
          <p className="mt-1 text-sm text-teal-900/70">
            Spent ${budget.spentUsd?.toFixed(4) ?? "0"}
            {budget.monthlyUsd > 0 ? ` of $${budget.monthlyUsd} cap` : " (no cap set)"}
            {budget.exceeded ? (
              <span className="ml-2 font-semibold text-red-700">— exceeded</span>
            ) : null}
          </p>
        </div>
      ) : null}

      {approvals.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-amber-900">Pending approvals</h2>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {approvals.map((ap) => (
              <li
                key={ap._id}
                className="flex flex-col gap-2 rounded-xl border border-amber-100 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="font-semibold text-teal-950">{ap.type || "submit"}</div>
                  <div className="text-teal-900/80">{ap.question}</div>
                  <div className="text-xs text-teal-900/50">
                    {ap.createdAt ? new Date(ap.createdAt).toLocaleString() : ""}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="min-h-10 rounded-xl bg-teal-700 px-3 text-sm font-semibold text-white"
                    onClick={() => resolveApproval(ap._id, "approved")}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="min-h-10 rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700"
                    onClick={() => resolveApproval(ap._id, "denied")}
                  >
                    Deny
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {improvements.length > 0 ? (
        <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-violet-900">Improvement proposals</h2>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {improvements.map((p) => (
              <li
                key={p._id}
                className="flex flex-col gap-2 rounded-xl border border-violet-100 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="font-semibold">{p.title || p.kind || "Proposal"}</div>
                  <div className="text-teal-900/80">{p.summary || p.recommendation}</div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="min-h-10 rounded-xl bg-teal-700 px-3 text-sm font-semibold text-white"
                    onClick={() => resolveImprovement(p._id, "approved")}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="min-h-10 rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700"
                    onClick={() => resolveImprovement(p._id, "rejected")}
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {reviews.length > 0 ? (
        <div className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-teal-900/80">Performance reviews</h2>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {reviews.slice(0, 5).map((r) => (
              <li key={r._id} className="rounded-xl border border-teal-50 p-3">
                <div className="font-semibold">Agent {String(r.agent || "").slice(-8)}</div>
                <div className="text-teal-900/70">{r.summary || r.overallRating}</div>
              </li>
            ))}
          </ul>
        </div>
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
