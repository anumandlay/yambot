/**
 * @fileoverview Agent runs history — filter by agent/status/date and show final replies.
 * Purpose: /runs (all agents) and /agents/:id/runs (single agent status).
 * Downstream: GET /api/runs, GET /api/agents/:id/runs.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { PageGuideBanner } from "../components/FieldLabel.jsx";
import { ExplainChainPanel } from "../components/ExplainChainPanel.jsx";

const STATUSES = [
  { value: "all", label: "All statuses" },
  { value: "done", label: "Done" },
  { value: "error", label: "Error" },
  { value: "running", label: "Running" },
  { value: "pending", label: "Pending" },
  { value: "waiting_user", label: "Waiting for you" },
  { value: "cancelled", label: "Cancelled" },
];

/**
 * @param {string|Date|null|undefined} d
 */
function fmtWhen(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString();
  } catch {
    return "—";
  }
}

/**
 * @param {string} status
 */
function statusClass(status) {
  switch (status) {
    case "done":
      return "bg-emerald-100 text-emerald-900";
    case "error":
      return "bg-rose-100 text-rose-900";
    case "running":
      return "bg-sky-100 text-sky-900";
    case "waiting_user":
      return "bg-amber-100 text-amber-950";
    case "pending":
      return "bg-slate-100 text-slate-800";
    default:
      return "bg-teal-50 text-teal-900";
  }
}

/**
 * Shared runs list UI for /runs and /agents/:agentId/runs.
 */
export function AgentRunsPage() {
  const { agentId: routeAgentId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const lockedAgentId = routeAgentId || "";

  const [agents, setAgents] = useState([]);
  const [agentMeta, setAgentMeta] = useState(null);
  const [runs, setRuns] = useState([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [askWhy, setAskWhy] = useState("");
  const [diagnoseBusy, setDiagnoseBusy] = useState(false);
  const [diagnoseResult, setDiagnoseResult] = useState(null);
  const [explainBusy, setExplainBusy] = useState("");
  const [explainResult, setExplainResult] = useState(null);

  const agentId = lockedAgentId || searchParams.get("agentId") || "";
  const status = searchParams.get("status") || "all";
  const q = searchParams.get("q") || "";
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";

  const title = lockedAgentId
    ? agentMeta?.name
      ? `${agentMeta.name} · Runs`
      : "Agent runs"
    : "Agent runs";

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (agentId) p.set("agentId", agentId);
    if (status && status !== "all") p.set("status", status);
    if (q.trim()) p.set("q", q.trim());
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    p.set("limit", "80");
    return p.toString();
  }, [agentId, status, q, from, to]);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api(`/api/runs?${qs}`);
      setRuns(data.runs || []);
      setTotal(data.total || 0);
      setAgents(data.agents || []);
      if (lockedAgentId) {
        const matched = (data.agents || []).find((a) => a._id === lockedAgentId);
        setAgentMeta(
          matched || {
            _id: lockedAgentId,
            name: data.runs?.[0]?.agentName || "Agent",
            skill: "",
            online: false,
          }
        );
      } else {
        setAgentMeta(null);
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [lockedAgentId, qs]);

  useEffect(() => {
    document.title = `${title} · YamBot`;
  }, [title]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * @param {string} key
   * @param {string} value
   */
  function setFilter(key, value) {
    const next = new URLSearchParams(searchParams);
    if (!value || (key === "status" && value === "all") || (key === "agentId" && lockedAgentId)) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        <p className="mt-1 text-sm text-teal-900/70">
          When each agent ran and the final reply it produced. Filter by agent, status, or date.
        </p>
        {lockedAgentId ? (
          <p className="mt-1 text-xs text-teal-800/70">
            <Link className="font-semibold underline" to={`/agents/${lockedAgentId}`}>
              Edit agent
            </Link>
            {" · "}
            <Link className="font-semibold underline" to="/runs">
              All agent runs
            </Link>
          </p>
        ) : null}
      </div>

      <PageGuideBanner helpId={lockedAgentId ? "agent.runs" : "runs.page"} />
      {error ? <ErrorAlert error={error} onClose={() => setError(null)} /> : null}

      {agentMeta ? (
        <div className="rounded-xl border border-teal-100 bg-teal-50/50 px-3 py-2 text-xs text-teal-900/80">
          <span className="font-semibold">{agentMeta.name}</span>
          {agentMeta.skill ? <span> · {agentMeta.skill}</span> : null}
          <span> · {agentMeta.online ? "online" : "offline"}</span>
          {agentMeta.schedule?.enabled ? (
            <span>
              {" "}
              · schedule {agentMeta.schedule.interval}
              {agentMeta.schedule.lastRunAt
                ? ` · last tick ${fmtWhen(agentMeta.schedule.lastRunAt)}`
                : ""}
            </span>
          ) : null}
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-3 rounded-2xl border border-teal-100 bg-white p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        {!lockedAgentId ? (
          <label className="flex flex-col gap-1 text-xs font-semibold text-teal-950 sm:col-span-2 lg:col-span-1">
            Agent
            <select
              className="min-h-11 rounded-xl border border-teal-100 bg-white px-3 text-sm font-normal"
              value={agentId}
              onChange={(e) => setFilter("agentId", e.target.value)}
            >
              <option value="">All agents</option>
              {agents.map((a) => (
                <option key={a._id} value={a._id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-xs font-semibold text-teal-950">
          Status
          <select
            className="min-h-11 rounded-xl border border-teal-100 bg-white px-3 text-sm font-normal"
            value={status}
            onChange={(e) => setFilter("status", e.target.value)}
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-teal-950">
          From
          <input
            type="date"
            className="min-h-11 rounded-xl border border-teal-100 bg-white px-3 text-sm font-normal"
            value={from}
            onChange={(e) => setFilter("from", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-teal-950">
          To
          <input
            type="date"
            className="min-h-11 rounded-xl border border-teal-100 bg-white px-3 text-sm font-normal"
            value={to}
            onChange={(e) => setFilter("to", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-teal-950 sm:col-span-2 lg:col-span-4">
          Search goal / reply
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="search"
              className="min-h-11 w-full flex-1 rounded-xl border border-teal-100 bg-white px-3 text-sm font-normal"
              placeholder="e.g. invoice, replied, failed…"
              value={q}
              onChange={(e) => setFilter("q", e.target.value)}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void load()}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-teal-200 bg-teal-50 px-4 text-sm font-semibold text-teal-950 disabled:opacity-50"
            >
              {busy ? "Loading…" : "Refresh"}
            </button>
          </div>
        </label>
      </section>

      <p className="text-xs text-teal-800/60">
        {total} run{total === 1 ? "" : "s"}
        {busy ? " · loading…" : ""}
      </p>

      <section className="rounded-2xl border border-sky-200 bg-sky-50/70 p-3">
        <h2 className="text-sm font-bold text-sky-950">Ask why</h2>
        <p className="mt-1 text-xs text-sky-900/75">
          Natural-language diagnosis of recent runs (uses your LLM).
        </p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            className="min-h-11 flex-1 rounded-xl border border-sky-200 bg-white px-3 text-sm"
            placeholder="e.g. Why didn’t it send the email?"
            value={askWhy}
            onChange={(e) => setAskWhy(e.target.value)}
          />
          <button
            type="button"
            disabled={diagnoseBusy || (!askWhy.trim() && !agentId && !lockedAgentId)}
            className="min-h-11 rounded-xl bg-sky-800 px-4 text-sm font-semibold text-white disabled:opacity-50"
            onClick={() =>
              void (async () => {
                setDiagnoseBusy(true);
                setDiagnoseResult(null);
                try {
                  const data = await api("/api/ceo/diagnose", {
                    method: "POST",
                    body: JSON.stringify({
                      agentId: lockedAgentId || agentId || undefined,
                      question: askWhy.trim() || "Why did recent runs fail?",
                    }),
                    timeoutMs: 120_000,
                  });
                  setDiagnoseResult(data);
                } catch (err) {
                  setError(err);
                } finally {
                  setDiagnoseBusy(false);
                }
              })()
            }
          >
            {diagnoseBusy ? "Diagnosing…" : "Ask why"}
          </button>
        </div>
        {diagnoseResult ? (
          <div className="mt-3 rounded-xl border border-sky-200 bg-white p-3 text-sm text-sky-950">
            <p className="whitespace-pre-wrap">{diagnoseResult.assistantMessage}</p>
            {diagnoseResult.fixes?.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {diagnoseResult.fixes.map((f, i) => (
                  <Link
                    key={i}
                    to={f.href}
                    className="inline-flex min-h-9 items-center rounded-lg border border-sky-200 px-2 text-xs font-semibold"
                  >
                    {f.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {explainResult ? (
          <div className="mt-3">
            <ExplainChainPanel
              chain={explainResult.chain}
              howHumanWouldConfigure={explainResult.howHumanWouldConfigure}
              narrative={explainResult.narrative}
              correlationId={explainResult.correlationId}
              onClose={() => setExplainResult(null)}
            />
          </div>
        ) : null}
      </section>

      <ul className="flex flex-col gap-3">
        {runs.length === 0 && !busy ? (
          <li className="rounded-2xl border border-dashed border-teal-200 bg-teal-50/40 p-6 text-center text-sm text-teal-900/70">
            No runs match these filters yet. After an agent completes a chat or scheduled goal, it
            shows here with the final reply.
          </li>
        ) : null}
        {runs.map((r) => {
          const open = expanded === r._id;
          const reply = r.resultSummary || r.lastError || "";
          return (
            <li
              key={r._id}
              className="rounded-2xl border border-teal-100 bg-white p-3 shadow-sm sm:p-4"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-md px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide ${statusClass(
                        r.status
                      )}`}
                    >
                      {r.status}
                    </span>
                    {!lockedAgentId && r.agentId ? (
                      <Link
                        className="text-sm font-semibold text-teal-800 underline"
                        to={`/agents/${r.agentId}/runs`}
                      >
                        {r.agentName || "Agent"}
                      </Link>
                    ) : null}
                    <span className="text-xs text-teal-800/60">{fmtWhen(r.startedAt)}</span>
                    {r.completedAt ? (
                      <span className="text-xs text-teal-800/50">→ {fmtWhen(r.completedAt)}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm font-medium text-teal-950">{r.goal || "(no goal)"}</p>
                  {reply ? (
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-teal-900/80">
                      <span className="font-semibold text-teal-900/60">Final reply: </span>
                      {reply}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-teal-800/50">No final reply recorded yet.</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {r.chatId ? (
                    <Link
                      to={`/chats/${r.chatId}`}
                      className="inline-flex min-h-10 items-center rounded-xl border border-teal-200 px-3 text-xs font-semibold text-teal-900"
                    >
                      Open chat
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    className="inline-flex min-h-10 items-center rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-950 disabled:opacity-50"
                    disabled={Boolean(explainBusy)}
                    onClick={() =>
                      void (async () => {
                        setExplainBusy(r._id);
                        setError(null);
                        try {
                          const data = await api(`/api/explain?taskId=${encodeURIComponent(r._id)}`);
                          setExplainResult(data);
                        } catch (err) {
                          setError(err);
                        } finally {
                          setExplainBusy("");
                        }
                      })()
                    }
                  >
                    {explainBusy === r._id ? "…" : "Explain"}
                  </button>
                  <button
                    type="button"
                    className="inline-flex min-h-10 items-center rounded-xl border border-teal-100 px-3 text-xs font-semibold text-teal-800"
                    onClick={() => setExpanded(open ? null : r._id)}
                  >
                    {open ? "Hide" : "Full reply"}
                  </button>
                </div>
              </div>
              {open && reply ? (
                <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-teal-50 bg-slate-50 p-3 text-xs text-teal-950">
                  {reply}
                </pre>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
