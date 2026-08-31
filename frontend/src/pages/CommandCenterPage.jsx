/**
 * @fileoverview Command Center — CEO AI chat, discovery, readiness, emergency stop.
 * Purpose: Manage the business in English without visiting every agent form.
 * Downstream: POST /api/ceo/*, GET /api/capabilities, /api/system/emergency-*.
 */

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { PageGuideBanner } from "../components/FieldLabel.jsx";

/**
 * @param {object} action
 * @param {(a: object) => void} onAction
 */
function ActionButtons({ actions, onAction }) {
  if (!actions?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {actions.map((a, i) => (
        <button
          key={`${a.type}-${i}`}
          type="button"
          onClick={() => onAction(a)}
          className="inline-flex min-h-10 items-center rounded-xl border border-teal-200 bg-white px-3 text-xs font-semibold text-teal-950"
        >
          {a.label || a.type}
        </button>
      ))}
    </div>
  );
}

export function CommandCenterPage() {
  const navigate = useNavigate();
  const bottomRef = useRef(null);
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "I’m your Command Center. Describe a business outcome, ask why an agent failed, or say “find automations”. I’ll propose safe next steps.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(null);
  const [health, setHealth] = useState(null);
  const [capabilities, setCapabilities] = useState(null);
  const [opportunities, setOpportunities] = useState(null);
  const [diagnoseBox, setDiagnoseBox] = useState(null);
  const [department, setDepartment] = useState(null);
  const [sopText, setSopText] = useState("");
  const [sopResult, setSopResult] = useState(null);
  const [deptRequest, setDeptRequest] = useState("");
  const [optimize, setOptimize] = useState(null);
  const [learningMode, setLearningMode] = useState(false);
  const [pulse, setPulse] = useState(null);

  async function reloadPulse() {
    const p = await api("/api/ceo/pulse").catch(() => null);
    setPulse(p);
  }

  useEffect(() => {
    document.title = "Command Center · YamBot";
    Promise.all([
      api("/api/capabilities").catch(() => null),
      api("/api/company-dashboard").catch(() => null),
      api("/api/policies").catch(() => null),
      api("/api/ceo/pulse").catch(() => null),
    ]).then(([cap, dash, pol, p]) => {
      setCapabilities(cap);
      // Why: API nests payload under `dashboard`; older clients expected flat fields.
      setHealth(dash?.dashboard || dash || null);
      setLearningMode(pol?.policy?.learningMode === true);
      setPulse(p);
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, diagnoseBox, opportunities]);

  /**
   * @param {object} action
   */
  async function handleAction(action) {
    const type = action.type;
    if (type === "link" && action.href) {
      navigate(action.href);
      return;
    }
    if (type === "open_architect" || type === "propose_hire") {
      const q = encodeURIComponent(action.prompt || "");
      navigate(q ? `/architect?prompt=${q}` : "/architect");
      return;
    }
    if (type === "propose_change") {
      const id = action.blueprintId;
      const q = encodeURIComponent(action.prompt || "");
      navigate(id ? `/architect?id=${id}&change=${q}` : `/architect?change=${q}`);
      return;
    }
    if (type === "show_readiness") {
      navigate("/agents");
      return;
    }
    if (type === "discover") {
      await runDiscover(action.prompt || "");
      return;
    }
    if (type === "diagnose_run") {
      await runDiagnose(action.agentId || "", action.question || action.prompt || "");
      return;
    }
    if (type === "diagnose") {
      await runDiagnose(action.agentId || "", action.question || "Why is this agent unhealthy?");
      return;
    }
    if (
      type === "apply_recovery" ||
      type === "spawn_goal_work" ||
      type === "apply_model_route" ||
      type === "hire_roles"
    ) {
      setBusy("pulse");
      setError(null);
      try {
        const data = await api("/api/ceo/pulse/act", {
          method: "POST",
          body: JSON.stringify(action),
        });
        setMessages((m) => [
          ...m,
          { role: "assistant", content: data.detail || "Pulse action applied." },
        ]);
        await reloadPulse();
      } catch (err) {
        setError(err);
      } finally {
        setBusy("");
      }
      return;
    }
    if (type === "emergency_stop") {
      if (!window.confirm("Stop ALL AI agents and pause schedules for this account?")) return;
      setBusy("stop");
      try {
        const data = await api("/api/system/emergency-stop", {
          method: "POST",
          body: JSON.stringify({}),
        });
        setMessages((m) => [
          ...m,
          { role: "assistant", content: data.detail || "Emergency stop complete." },
        ]);
      } catch (err) {
        setError(err);
      } finally {
        setBusy("");
      }
      return;
    }
    if (type === "emergency_resume") {
      setBusy("resume");
      try {
        const data = await api("/api/system/emergency-resume", {
          method: "POST",
          body: JSON.stringify({}),
        });
        setMessages((m) => [
          ...m,
          { role: "assistant", content: data.detail || "Emergency resume complete." },
        ]);
      } catch (err) {
        setError(err);
      } finally {
        setBusy("");
      }
    }
  }

  async function runDiscover(brief = "") {
    setBusy("discover");
    setError(null);
    try {
      const data = await api("/api/ceo/discover", {
        method: "POST",
        body: JSON.stringify({ brief }),
        timeoutMs: 120_000,
      });
      setOpportunities(data.opportunities || []);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.assistantMessage || "Here are opportunities." },
      ]);
    } catch (err) {
      setError(err);
    } finally {
      setBusy("");
    }
  }

  async function runDiagnose(agentId, question) {
    setBusy("diagnose");
    setError(null);
    try {
      const data = await api("/api/ceo/diagnose", {
        method: "POST",
        body: JSON.stringify({ agentId, question }),
        timeoutMs: 120_000,
      });
      setDiagnoseBox(data);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.assistantMessage || "Diagnosis ready." },
      ]);
    } catch (err) {
      setError(err);
    } finally {
      setBusy("");
    }
  }

  async function onSend() {
    const text = draft.trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user", content: text }];
    setMessages(next);
    setDraft("");
    setBusy("chat");
    setError(null);
    try {
      const data = await api("/api/ceo/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: next.filter((m) => m.role === "user" || m.role === "assistant"),
        }),
        timeoutMs: 120_000,
      });
      setMessages([
        ...next,
        {
          role: "assistant",
          content: data.assistantMessage || "…",
          actions: data.actions || [],
        },
      ]);
    } catch (err) {
      setError(err);
    } finally {
      setBusy("");
    }
  }

  const summary = capabilities?.summary;
  const taskStats = Array.isArray(health?.tasksLast7Days) ? health.tasksLast7Days : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 pb-24">
      <PageGuideBanner helpId="command.page" />
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-teal-950 sm:text-3xl">
          Command Center
        </h1>
        <p className="mt-1 text-sm text-teal-900/70">
          Tell YamBot what the business needs — it discovers capabilities, diagnoses failures, and
          proposes the next hire.
        </p>
      </header>

      {learningMode ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          Learning mode is on (Policies) — Command Center answers include short WHY explanations.
        </p>
      ) : null}

      <section className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={Boolean(busy)}
          className="min-h-10 rounded-xl border border-teal-200 bg-white px-3 text-xs font-semibold text-teal-950 disabled:opacity-50"
          onClick={() =>
            void (async () => {
              setBusy("loop");
              setError(null);
              try {
                const data = await api("/api/ceo/loop", {
                  method: "POST",
                  body: JSON.stringify({}),
                  timeoutMs: 120_000,
                });
                setMessages((m) => [
                  ...m,
                  {
                    role: "assistant",
                    content: `CEO loop (${data.mode}): ${data.executed || 0} executed, ${data.recommended || 0} recommended from ${data.strategies?.length || 0} strategies.`,
                  },
                ]);
                await reloadPulse();
              } catch (err) {
                setError(err);
              } finally {
                setBusy("");
              }
            })()
          }
        >
          {busy === "loop" ? "Running loop…" : "Run CEO loop now"}
        </button>
        <button
          type="button"
          disabled={Boolean(busy)}
          className="min-h-10 rounded-xl border border-slate-300 bg-slate-900 px-3 text-xs font-semibold text-white disabled:opacity-50"
          onClick={() =>
            void (async () => {
              setBusy("audit");
              setError(null);
              try {
                const data = await api("/api/ceo/audit-company", {
                  method: "POST",
                  body: JSON.stringify({ withNarrative: true }),
                  timeoutMs: 120_000,
                });
                const tops = (data.findings || [])
                  .slice(0, 8)
                  .map((f) => `• [${f.severity}] ${f.title}`)
                  .join("\n");
                setMessages((m) => [
                  ...m,
                  {
                    role: "assistant",
                    content: [
                      data.narrative || "Company audit complete.",
                      "",
                      `Findings: ${data.counts?.findings ?? (data.findings || []).length}`,
                      tops,
                    ]
                      .filter(Boolean)
                      .join("\n"),
                  },
                ]);
              } catch (err) {
                setError(err);
              } finally {
                setBusy("");
              }
            })()
          }
        >
          {busy === "audit" ? "Auditing…" : "Audit my business"}
        </button>
        <button
          type="button"
          disabled={Boolean(busy)}
          className="min-h-10 rounded-xl border border-amber-300 bg-amber-50 px-3 text-xs font-semibold text-amber-950 disabled:opacity-50"
          onClick={() =>
            void (async () => {
              setBusy("optimize");
              setError(null);
              try {
                const data = await api("/api/ceo/optimize-loop", {
                  method: "POST",
                  body: JSON.stringify({}),
                  timeoutMs: 120_000,
                });
                setMessages((m) => [
                  ...m,
                  {
                    role: "assistant",
                    content: `Continuous optimize: started ${data.experimentsStarted || 0} experiment(s), promoted ${data.promoted || 0}, rolled back ${data.rolledBack || 0}.`,
                  },
                ]);
              } catch (err) {
                setError(err);
              } finally {
                setBusy("");
              }
            })()
          }
        >
          {busy === "optimize" ? "Optimizing…" : "Run optimize loop"}
        </button>
        <button
          type="button"
          disabled={Boolean(busy)}
          className="min-h-10 rounded-xl border border-emerald-400 bg-emerald-50 px-3 text-xs font-semibold text-emerald-950 disabled:opacity-50"
          onClick={() =>
            void (async () => {
              setBusy("proofs");
              setError(null);
              try {
                const data = await api("/api/proofs/run", {
                  method: "POST",
                  body: JSON.stringify({ cleanup: false, suite: "all" }),
                  timeoutMs: 300_000,
                });
                const lines = (data.results || []).map(
                  (r) =>
                    `${r.passed ? "PASS" : "FAIL"} ${r.id || r.name}${r.detail ? `: ${r.detail}` : ""}`
                );
                setMessages((m) => [
                  ...m,
                  {
                    role: "assistant",
                    content: [
                      `BOS+harden proofs ${data.ok ? "PASSED" : "FAILED"} (${data.summary?.passed}/${data.summary?.total}).`,
                      ...lines,
                    ].join("\n"),
                  },
                ]);
              } catch (err) {
                setError(err);
              } finally {
                setBusy("");
              }
            })()
          }
        >
          {busy === "proofs" ? "Proving…" : "Run BOS+harden proofs"}
        </button>
        <button
          type="button"
          disabled={Boolean(busy)}
          className="min-h-10 rounded-xl border border-slate-300 bg-slate-50 px-3 text-xs font-semibold text-slate-800 disabled:opacity-50"
          onClick={() =>
            void (async () => {
              setBusy("livebos");
              setError(null);
              try {
                const data = await api("/api/proofs/run", {
                  method: "POST",
                  body: JSON.stringify({ suite: "live" }),
                  timeoutMs: 300_000,
                });
                const lines = (data.results || []).map(
                  (r) =>
                    `${String(r.status || (r.passed ? "PASS" : "FAIL")).toUpperCase()} ${r.id || r.name}${
                      r.detail ? `: ${r.detail}` : ""
                    }`
                );
                const matrix = data.matrix
                  ? Object.entries(data.matrix)
                      .map(([k, v]) => `  ${k}: ${v}`)
                      .join("\n")
                  : "";
                setMessages((m) => [
                  ...m,
                  {
                    role: "assistant",
                    content: [
                      `LIVE_BOS TEST_ONLY — PASS=${data.summary?.passed} FAIL=${data.summary?.failed} BLOCKED=${data.summary?.blocked} (total ${data.summary?.total}).`,
                      data.sandboxBosNote || "",
                      data.reason || "",
                      matrix ? `MATRIX:\n${matrix}` : "",
                      ...lines,
                    ]
                      .filter(Boolean)
                      .join("\n"),
                  },
                ]);
              } catch (err) {
                setError(err);
              } finally {
                setBusy("");
              }
            })()
          }
        >
          {busy === "livebos" ? "LIVE_BOS…" : "Run LIVE_BOS (real E2E)"}
        </button>
      </section>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-2xl border border-teal-100 bg-white p-3 shadow-sm">
          <div className="text-xs font-semibold uppercase text-teal-800/60">Agents</div>
          <div className="text-xl font-bold text-teal-950">{summary?.agentCount ?? "—"}</div>
        </div>
        <div className="rounded-2xl border border-teal-100 bg-white p-3 shadow-sm">
          <div className="text-xs font-semibold uppercase text-teal-800/60">Avg readiness</div>
          <div className="text-xl font-bold text-teal-950">
            {summary?.avgReadiness != null ? `${summary.avgReadiness}%` : "—"}
          </div>
        </div>
        <div className="rounded-2xl border border-teal-100 bg-white p-3 shadow-sm">
          <div className="text-xs font-semibold uppercase text-teal-800/60">Skills</div>
          <div className="text-xl font-bold text-teal-950">{summary?.skillCount ?? "—"}</div>
        </div>
        <div className="rounded-2xl border border-teal-100 bg-white p-3 shadow-sm">
          <div className="text-xs font-semibold uppercase text-teal-800/60">Triggers</div>
          <div className="text-xl font-bold text-teal-950">{summary?.triggerCount ?? "—"}</div>
        </div>
      </section>

      {pulse?.findings?.length ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-rose-950">
              Business pulse · {pulse.summary?.findingCount || pulse.findings.length} finding
              {(pulse.summary?.findingCount || pulse.findings.length) === 1 ? "" : "s"}
              {pulse.summary?.high ? ` · ${pulse.summary.high} high` : ""}
            </h2>
            <button
              type="button"
              disabled={Boolean(busy)}
              className="min-h-9 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold disabled:opacity-50"
              onClick={() => void reloadPulse().catch((err) => setError(err))}
            >
              Refresh
            </button>
          </div>
          <p className="mt-1 text-xs text-rose-900/70">
            Proactive observe → decide → act. Auto-fixes respect Policies max authority (
            {pulse.maxAuthorityLevel || "external"}).
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {pulse.findings.slice(0, 12).map((f) => (
              <li
                key={f.id}
                className="rounded-xl border border-rose-100 bg-white p-3 text-sm text-teal-950"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span
                      className={`mr-2 rounded px-1.5 py-0.5 text-[0.65rem] font-bold uppercase ${
                        f.severity === "high"
                          ? "bg-rose-200 text-rose-950"
                          : f.severity === "medium"
                            ? "bg-amber-100 text-amber-950"
                            : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {f.severity}
                    </span>
                    <span className="font-semibold">{f.title}</span>
                    {f.detail ? (
                      <p className="mt-1 text-xs text-teal-800/70">{f.detail}</p>
                    ) : null}
                  </div>
                </div>
                {f.actions?.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {f.actions.map((a, i) =>
                      a.type === "link" && a.href ? (
                        <Link
                          key={`${f.id}-${i}`}
                          to={a.href}
                          className="inline-flex min-h-9 items-center rounded-lg border border-teal-200 px-2 text-xs font-semibold"
                        >
                          {a.label}
                        </Link>
                      ) : (
                        <button
                          key={`${f.id}-${i}`}
                          type="button"
                          disabled={Boolean(busy)}
                          className="inline-flex min-h-9 items-center rounded-lg bg-teal-800 px-2 text-xs font-semibold text-white disabled:opacity-50"
                          onClick={() => void handleAction(a)}
                        >
                          {a.label || a.type}
                        </button>
                      )
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void runDiscover()}
          className="min-h-11 rounded-xl bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy === "discover" ? "Finding…" : "Find automation opportunities"}
        </button>
        <Link
          to="/architect"
          className="inline-flex min-h-11 items-center rounded-xl border border-teal-200 bg-white px-4 text-sm font-semibold"
        >
          Hire employee (Architect)
        </Link>
        <Link
          to="/connections"
          className="inline-flex min-h-11 items-center rounded-xl border border-teal-200 bg-white px-4 text-sm font-semibold"
        >
          Connections
        </Link>
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void handleAction({ type: "emergency_stop", label: "Stop" })}
          className="min-h-11 rounded-xl border border-rose-300 bg-rose-50 px-4 text-sm font-semibold text-rose-800 disabled:opacity-50"
        >
          {busy === "stop" ? "Stopping…" : "Stop all AI"}
        </button>
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void handleAction({ type: "emergency_resume", label: "Resume" })}
          className="min-h-11 rounded-xl border border-emerald-300 bg-emerald-50 px-4 text-sm font-semibold text-emerald-900 disabled:opacity-50"
        >
          {busy === "resume" ? "Resuming…" : "Resume AI"}
        </button>
      </div>

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}

      {opportunities?.length ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
          <h2 className="text-sm font-bold text-amber-950">Automation opportunities</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {opportunities.map((o) => (
              <li
                key={o.id}
                className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-teal-950">{o.title}</div>
                  <div className="text-xs text-teal-800/70">
                    Effort {o.effort} · ~{o.automationPct}% automatable
                  </div>
                  {o.reason ? <p className="mt-1 text-xs text-teal-900/70">{o.reason}</p> : null}
                </div>
                <Link
                  to={`/architect?prompt=${encodeURIComponent(o.architectPrompt)}`}
                  className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl bg-amber-700 px-3 text-xs font-semibold text-white"
                >
                  Create in Architect
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {diagnoseBox ? (
        <section className="rounded-2xl border border-sky-200 bg-sky-50/80 p-4 text-sm">
          <h2 className="font-bold text-sky-950">Diagnosis</h2>
          {diagnoseBox.causes?.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sky-950/90">
              {diagnoseBox.causes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          ) : null}
          {diagnoseBox.fixes?.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {diagnoseBox.fixes.map((f, i) => (
                <Link
                  key={i}
                  to={f.href}
                  className="inline-flex min-h-10 items-center rounded-xl border border-sky-300 bg-white px-3 text-xs font-semibold"
                >
                  {f.label}
                </Link>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
          <h2 className="text-sm font-bold text-violet-950">Turn SOP into employees</h2>
          <textarea
            className="mt-2 min-h-28 w-full rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm"
            placeholder="Paste an SOP, checklist, or process manual…"
            value={sopText}
            onChange={(e) => setSopText(e.target.value)}
          />
          <button
            type="button"
            disabled={Boolean(busy) || sopText.trim().length < 40}
            className="mt-2 min-h-11 rounded-xl bg-violet-800 px-4 text-sm font-semibold text-white disabled:opacity-50"
            onClick={() =>
              void (async () => {
                setBusy("sop");
                setError(null);
                try {
                  const data = await api("/api/ceo/from-sop", {
                    method: "POST",
                    body: JSON.stringify({ text: sopText }),
                    timeoutMs: 120_000,
                  });
                  setSopResult(data);
                  setMessages((m) => [
                    ...m,
                    { role: "assistant", content: data.assistantMessage || "SOP converted." },
                  ]);
                } catch (err) {
                  setError(err);
                } finally {
                  setBusy("");
                }
              })()
            }
          >
            {busy === "sop" ? "Parsing…" : "Convert SOP"}
          </button>
          {sopResult?.architectPrompt ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Link
                to={`/architect?prompt=${encodeURIComponent(sopResult.architectPrompt)}`}
                className="inline-flex min-h-10 items-center rounded-xl border border-violet-300 bg-white px-3 text-xs font-semibold"
              >
                Open in Architect
              </Link>
              {sopResult.roles?.length ? (
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  className="inline-flex min-h-10 items-center rounded-xl bg-violet-900 px-3 text-xs font-semibold text-white disabled:opacity-50"
                  onClick={() =>
                    void handleAction({
                      type: "hire_roles",
                      authority: "external",
                      roles: sopResult.roles,
                      departmentName: sopResult.departmentName || "SOP team",
                      rationale: "Hired from SOP conversion",
                    })
                  }
                >
                  {busy === "pulse" ? "Hiring…" : "Hire all roles now"}
                </button>
              ) : null}
            </div>
          ) : null}
          {sopResult?.requiredConnections?.length ? (
            <p className="mt-2 text-xs text-violet-900/80">
              Needs: {sopResult.requiredConnections.join(", ")} —{" "}
              <Link className="underline" to="/connections">
                Connections
              </Link>
            </p>
          ) : null}
        </div>

        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4">
          <h2 className="text-sm font-bold text-indigo-950">Hire a department</h2>
          <input
            className="mt-2 min-h-11 w-full rounded-xl border border-indigo-200 bg-white px-3 text-sm"
            placeholder='e.g. "Build an AI sales department"'
            value={deptRequest}
            onChange={(e) => setDeptRequest(e.target.value)}
          />
          <button
            type="button"
            disabled={Boolean(busy) || deptRequest.trim().length < 12}
            className="mt-2 min-h-11 rounded-xl bg-indigo-800 px-4 text-sm font-semibold text-white disabled:opacity-50"
            onClick={() =>
              void (async () => {
                setBusy("dept");
                setError(null);
                try {
                  const data = await api("/api/ceo/hire-department", {
                    method: "POST",
                    body: JSON.stringify({ request: deptRequest }),
                    timeoutMs: 120_000,
                  });
                  setDepartment(data);
                  setMessages((m) => [
                    ...m,
                    { role: "assistant", content: data.assistantMessage || "Department proposed." },
                  ]);
                } catch (err) {
                  setError(err);
                } finally {
                  setBusy("");
                }
              })()
            }
          >
            {busy === "dept" ? "Designing…" : "Design department"}
          </button>
          {department?.roles?.length ? (
            <>
              <ul className="mt-3 flex flex-col gap-2">
                {department.roles.map((r) => (
                  <li
                    key={r.id || r.title}
                    className="flex flex-col gap-1 rounded-xl border border-indigo-200 bg-white p-2 text-xs sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="font-semibold">{r.title}</div>
                      <div className="text-indigo-900/70">{r.responsibilities?.slice(0, 120)}</div>
                    </div>
                    <Link
                      to={`/architect?prompt=${encodeURIComponent(r.architectPrompt)}`}
                      className="inline-flex min-h-9 items-center justify-center rounded-lg bg-indigo-700 px-2 font-semibold text-white"
                    >
                      Hire in Architect
                    </Link>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={Boolean(busy)}
                className="mt-2 min-h-10 rounded-xl bg-indigo-950 px-3 text-xs font-semibold text-white disabled:opacity-50"
                onClick={() =>
                  void handleAction({
                    type: "hire_roles",
                    authority: "external",
                    roles: department.roles,
                    departmentName: department.departmentName || "Department",
                    sharedRules: department.sharedRules,
                    kpis: department.kpis,
                    rationale: "Hired from department design",
                  })
                }
              >
                {busy === "pulse" ? "Hiring…" : "Hire entire department now"}
              </button>
            </>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-teal-100 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-teal-950">Model cost optimizer</h2>
          <button
            type="button"
            disabled={Boolean(busy)}
            className="min-h-10 rounded-xl border border-teal-200 px-3 text-xs font-semibold disabled:opacity-50"
            onClick={() =>
              void (async () => {
                setBusy("opt");
                try {
                  const data = await api("/api/ceo/optimize-models");
                  setOptimize(data);
                } catch (err) {
                  setError(err);
                } finally {
                  setBusy("");
                }
              })()
            }
          >
            {busy === "opt" ? "Analyzing…" : "Analyze"}
          </button>
        </div>
        {optimize?.suggestions?.length ? (
          <>
            <ul className="mt-2 space-y-1 text-sm">
              {optimize.suggestions.slice(0, 12).map((s, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <Link className="font-semibold underline" to={`/agents/${s.agentId}`}>
                      {s.agentName}
                    </Link>
                    : {s.reason}
                  </span>
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    className="rounded-lg border border-teal-200 px-2 py-1 text-xs font-semibold disabled:opacity-50"
                    onClick={() =>
                      void handleAction({
                        type: "apply_model_route",
                        authority: "internal",
                        agentId: s.agentId,
                        profileId: s.profileId,
                        reason: s.reason,
                      })
                    }
                  >
                    Apply → {s.profileName}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={Boolean(busy)}
              className="mt-2 min-h-10 rounded-xl bg-teal-800 px-3 text-xs font-semibold text-white disabled:opacity-50"
              onClick={() =>
                void (async () => {
                  setBusy("opt_apply");
                  try {
                    const data = await api("/api/ceo/optimize-models/apply", {
                      method: "POST",
                      body: JSON.stringify({}),
                    });
                    setMessages((m) => [
                      ...m,
                      { role: "assistant", content: data.detail || "Model routes applied." },
                    ]);
                    const refreshed = await api("/api/ceo/optimize-models");
                    setOptimize(refreshed);
                  } catch (err) {
                    setError(err);
                  } finally {
                    setBusy("");
                  }
                })()
              }
            >
              {busy === "opt_apply" ? "Applying…" : "Apply all suggestions"}
            </button>
          </>
        ) : optimize ? (
          <p className="mt-2 text-xs text-teal-800/60">No routing changes suggested right now.</p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-teal-100 bg-gradient-to-b from-teal-50/80 to-white p-4 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-teal-900/60">
          What do you want YamBot to do?
        </h2>
        <div className="flex max-h-[min(50vh,28rem)] flex-col gap-3 overflow-y-auto">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`rounded-xl px-3 py-2 text-sm ${
                m.role === "user"
                  ? "ml-8 bg-teal-800 text-white"
                  : "mr-4 border border-teal-100 bg-white text-teal-950"
              }`}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.actions ? <ActionButtons actions={m.actions} onAction={handleAction} /> : null}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className="min-h-12 flex-1 rounded-xl border border-teal-200 bg-white px-3 text-sm"
            placeholder='e.g. “Increase qualified leads” or “Why did the email agent fail?”'
            value={draft}
            disabled={Boolean(busy)}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void onSend();
              }
            }}
          />
          <button
            type="button"
            disabled={Boolean(busy) || !draft.trim()}
            onClick={() => void onSend()}
            className="min-h-12 rounded-xl bg-teal-700 px-5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy === "chat" ? "Thinking…" : "Send"}
          </button>
        </div>
        {taskStats?.length ? (
          <p className="text-xs text-teal-800/60">
            Last 7 days:{" "}
            {taskStats.map((r) => `${r.status || "unknown"} ${r.count}`).join(" · ")}
          </p>
        ) : null}
      </section>

      {(capabilities?.agents || []).filter((a) => a.readinessScore < 80).length ? (
        <section className="rounded-2xl border border-teal-100 bg-white p-4">
          <h2 className="text-sm font-bold text-teal-950">Agents needing attention</h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {capabilities.agents
              .filter((a) => a.readinessScore < 80)
              .slice(0, 8)
              .map((a) => (
                <li key={a._id} className="flex items-center justify-between gap-2">
                  <Link className="font-semibold underline" to={`/agents/${a._id}`}>
                    {a.name}
                  </Link>
                  <span className="text-xs text-amber-800">Readiness {a.readinessScore}%</span>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
