/**
 * @fileoverview Business Architect — outcome-first designer (understanding → blueprint → build).
 * Purpose: Progressive analyst chat; confirm understanding; show diagram/why/checklist/uiMap; then create.
 * Downstream: POST /api/architect/chat, POST /api/architect/apply.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { PageGuideBanner } from "../components/FieldLabel.jsx";
import { ArchitectOpsHub } from "../components/ArchitectOpsHub.jsx";

const PROFILE_KEY = "yambot.architect.llmProfileId";

const WELCOME =
  "Describe the business outcome you want in plain English. I’ll ask only what’s necessary, confirm my understanding, then show a full architecture — nothing is created until you Approve & Build.";

/**
 * Simple top-down SVG flowchart from graph nodes/edges.
 * @param {{ nodes: object[], edges: object[] }} props
 */
function WorkflowDiagram({ nodes = [], edges = [] }) {
  const layout = useMemo(() => {
    if (!nodes.length) return { positions: {}, width: 320, height: 120 };
    const levels = new Map();
    const indeg = new Map(nodes.map((n) => [n.id, 0]));
    for (const e of edges) {
      if (indeg.has(e.to)) indeg.set(e.to, (indeg.get(e.to) || 0) + 1);
    }
    const roots = nodes.filter((n) => !indeg.get(n.id));
    const queue = (roots.length ? roots : [nodes[0]]).map((n) => ({ id: n.id, level: 0 }));
    const seen = new Set();
    while (queue.length) {
      const { id, level } = queue.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      levels.set(id, level);
      for (const e of edges.filter((x) => x.from === id)) {
        queue.push({ id: e.to, level: level + 1 });
      }
    }
    for (const n of nodes) {
      if (!levels.has(n.id)) levels.set(n.id, 0);
    }
    const byLevel = new Map();
    for (const n of nodes) {
      const lv = levels.get(n.id) || 0;
      if (!byLevel.has(lv)) byLevel.set(lv, []);
      byLevel.get(lv).push(n);
    }
    const maxLevel = Math.max(...byLevel.keys(), 0);
    const colW = 160;
    const rowH = 72;
    /** @type {Record<string, {x:number,y:number,w:number,h:number}>} */
    const positions = {};
    let maxX = 320;
    for (let lv = 0; lv <= maxLevel; lv += 1) {
      const row = byLevel.get(lv) || [];
      row.forEach((n, i) => {
        const x = 24 + i * colW;
        const y = 24 + lv * rowH;
        positions[n.id] = { x, y, w: 140, h: 44 };
        maxX = Math.max(maxX, x + 160);
      });
    }
    return {
      positions,
      width: maxX,
      height: 48 + (maxLevel + 1) * rowH,
    };
  }, [nodes, edges]);

  if (!nodes.length) {
    return <p className="text-xs text-teal-800/60">No workflow graph yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-950/95 p-2">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="min-h-[10rem] w-full min-w-[20rem]"
        role="img"
        aria-label="Workflow diagram"
      >
        {edges.map((e, i) => {
          const a = layout.positions[e.from];
          const b = layout.positions[e.to];
          if (!a || !b) return null;
          const x1 = a.x + a.w / 2;
          const y1 = a.y + a.h;
          const x2 = b.x + b.w / 2;
          const y2 = b.y;
          return (
            <g key={`e-${i}`}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="rgba(94,234,212,0.55)"
                strokeWidth="2"
                markerEnd="url(#arrow)"
              />
              {e.label ? (
                <text
                  x={(x1 + x2) / 2}
                  y={(y1 + y2) / 2 - 4}
                  fill="rgba(153,246,228,0.9)"
                  fontSize="9"
                  textAnchor="middle"
                >
                  {e.label}
                </text>
              ) : null}
            </g>
          );
        })}
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="rgba(94,234,212,0.8)" />
          </marker>
        </defs>
        {nodes.map((n) => {
          const p = layout.positions[n.id];
          if (!p) return null;
          return (
            <g key={n.id}>
              <rect
                x={p.x}
                y={p.y}
                width={p.w}
                height={p.h}
                rx="8"
                fill="rgba(15,118,110,0.35)"
                stroke="rgba(45,212,191,0.7)"
              />
              <text
                x={p.x + p.w / 2}
                y={p.y + 18}
                fill="#ecfdf5"
                fontSize="10"
                fontWeight="600"
                textAnchor="middle"
              >
                {(n.label || n.id).slice(0, 22)}
              </text>
              <text
                x={p.x + p.w / 2}
                y={p.y + 32}
                fill="rgba(153,246,228,0.75)"
                fontSize="8"
                textAnchor="middle"
              >
                {n.kind || "step"}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * @param {{ blueprint: object }} props
 */
function BlueprintPanel({ blueprint }) {
  const cl = blueprint.checklist || {};
  return (
    <div className="flex flex-col gap-5">
      {blueprint.summary ? (
        <p className="rounded-xl border border-teal-100 bg-teal-50/50 px-3 py-2 text-sm leading-relaxed text-teal-950">
          {blueprint.summary}
        </p>
      ) : null}

      <section>
        <h3 className="text-xs font-bold uppercase tracking-wide text-teal-900/60">
          What will you create?
        </h3>
        <ul className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          {[
            ["Agents", cl.agents],
            ["Schedules", cl.schedules],
            ["Triggers", cl.triggers],
            ["API connections", cl.apiConnections],
            ["Email connections", cl.emailConnections],
            ["Handoffs", cl.handoffs],
            ["Branches", cl.branches],
            ["Human approvals", cl.humanApprovals],
          ].map(([label, n]) => (
            <li
              key={label}
              className="rounded-xl border border-teal-100 bg-white px-3 py-2 text-teal-950"
            >
              <span className="font-bold">{Number(n) || 0}</span>
              <span className="ml-1 text-xs text-teal-800/70">{label}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-teal-900/60">
          Workflow
        </h3>
        <WorkflowDiagram nodes={blueprint.graph?.nodes || []} edges={blueprint.graph?.edges || []} />
      </section>

      {(blueprint.components || []).length ? (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-teal-900/60">
            Why am I using this?
          </h3>
          <ul className="mt-2 flex flex-col gap-2">
            {blueprint.components.map((c) => (
              <li key={c.id} className="rounded-xl border border-teal-100 bg-white p-3 text-sm">
                <div className="font-semibold text-teal-950">
                  {c.title}{" "}
                  <span className="font-mono text-[0.65rem] text-teal-800/50">{c.kind}</span>
                </div>
                <p className="mt-1 text-teal-900/80">{c.purpose}</p>
                {(c.uses || []).length ? (
                  <p className="mt-1 text-xs text-teal-800/70">Uses: {c.uses.join(" · ")}</p>
                ) : null}
                {c.starts ? (
                  <p className="mt-1 text-xs text-amber-900/80">Starts: {c.starts}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {(blueprint.branches || []).length ? (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-teal-900/60">
            Conditions / branches
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-teal-900/80">
            {blueprint.branches.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {(blueprint.failureHandling || []).length ? (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-teal-900/60">
            Failure handling
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-teal-900/80">
            {blueprint.failureHandling.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {(blueprint.humanApprovals || []).length ? (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-teal-900/60">
            Human approval points
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-950/90">
            {blueprint.humanApprovals.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {(blueprint.reuse || []).length ? (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-teal-900/60">
            Existing agents (reuse check)
          </h3>
          <ul className="mt-2 flex flex-col gap-2">
            {blueprint.reuse.map((r, i) => (
              <li
                key={i}
                className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-teal-950"
              >
                <div className="font-semibold">
                  {r.existingAgentName || r.existingAgentId || "Agent"} → {r.recommend}
                </div>
                <p className="mt-1 text-xs text-teal-900/75">{r.reason}</p>
                {r.changeRisk ? (
                  <p className="mt-1 text-xs text-amber-900/80">Risk: {r.changeRisk}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {(blueprint.uiMap || []).length ? (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-teal-900/60">
            Manual setup map (learn YamBot)
          </h3>
          <ul className="mt-2 flex flex-col gap-3">
            {blueprint.uiMap.map((row, i) => (
              <li
                key={`${row.page}-${i}`}
                className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-sm"
              >
                <div className="font-semibold text-teal-950">{row.page}</div>
                {row.routeHint ? (
                  <div className="font-mono text-[0.7rem] text-teal-800/60">{row.routeHint}</div>
                ) : null}
                {row.purpose ? (
                  <p className="mt-1 text-xs text-teal-900/75">{row.purpose}</p>
                ) : null}
                <ul className="mt-2 space-y-1 text-xs text-teal-900/80">
                  {(row.fields || []).map((f, j) => (
                    <li key={j}>
                      <span className="font-semibold">{f.label}:</span> {f.value || "—"}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {(blueprint.dataMaps || []).length ? (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-teal-900/60">
            Data mapping
          </h3>
          <ul className="mt-2 space-y-1 font-mono text-xs text-teal-900/80">
            {blueprint.dataMaps.map((m, i) => (
              <li key={i}>
                {m.source} → {m.target}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function BusinessArchitectPage() {
  const [searchParams] = useSearchParams();
  const [llmProfiles, setLlmProfiles] = useState([]);
  const [profileId, setProfileId] = useState(() => {
    try {
      return localStorage.getItem(PROFILE_KEY) || "";
    } catch {
      return "";
    }
  });
  const [messages, setMessages] = useState([{ role: "assistant", content: WELCOME }]);
  const [draft, setDraft] = useState("");
  const [answers, setAnswers] = useState({});
  const [pendingRequirements, setPendingRequirements] = useState([]);
  const [reqDraft, setReqDraft] = useState({});
  const [stage, setStage] = useState("gathering");
  const [understanding, setUnderstanding] = useState(null);
  const [blueprint, setBlueprint] = useState(null);
  const [blueprintId, setBlueprintId] = useState(searchParams.get("id") || null);
  const [created, setCreated] = useState(null);
  const [savedList, setSavedList] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [simBusy, setSimBusy] = useState(false);
  const bottomRef = useRef(null);

  const showOps = Boolean(blueprintId && (created || searchParams.get("id")));

  useEffect(() => {
    document.title = "Business Architect · YamBot";
    api("/api/llm-profiles")
      .then((data) => setLlmProfiles(data.profiles || []))
      .catch(() => setLlmProfiles([]));
    api("/api/architect")
      .then((data) => setSavedList(data.blueprints || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const id = searchParams.get("id");
    if (!id) return;
    setBlueprintId(id);
    api(`/api/architect/${id}`)
      .then((data) => {
        const d = data.blueprintDoc;
        if (d?.blueprint) {
          setBlueprint(d.blueprint);
          setStage(d.stage || "ready");
          setUnderstanding(d.understanding || null);
        }
        if (d?.status === "built") {
          setCreated({
            summary: d.title || d.understanding?.objective,
            agents: (d.createdAgentIds || []).map((aid) => ({ _id: aid, name: aid.slice(-6) })),
            triggers: (d.createdTriggerIds || []).map((tid) => ({ _id: tid })),
          });
        }
      })
      .catch((err) => setError(err));
  }, [searchParams]);

  useEffect(() => {
    try {
      if (profileId) localStorage.setItem(PROFILE_KEY, profileId);
      else localStorage.removeItem(PROFILE_KEY);
    } catch {
      /* ignore */
    }
  }, [profileId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingRequirements, understanding, blueprint, busy]);

  /**
   * @param {object[]} nextMessages
   * @param {object} [opts]
   */
  async function runChat(nextMessages, opts = {}) {
    setBusy(true);
    setError(null);
    try {
      const data = await api("/api/architect/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: nextMessages.filter((m) => m.role === "user" || m.role === "assistant"),
          profileId: profileId || undefined,
          answers: opts.answers ?? answers,
          understandingConfirmed: opts.understandingConfirmed === true,
          understandingRejected: opts.understandingRejected === true,
          blueprintId: blueprintId || undefined,
        }),
        timeoutMs: 120_000,
      });
      const reply = String(data.assistantMessage || "").trim() || "…";
      setMessages([...nextMessages, { role: "assistant", content: reply }]);
      setStage(data.stage || "gathering");
      setPendingRequirements(Array.isArray(data.pendingRequirements) ? data.pendingRequirements : []);
      setReqDraft({});
      setUnderstanding(data.understanding || null);
      setBlueprint(data.blueprint || null);
      if (data.blueprintId) setBlueprintId(data.blueprintId);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function onSend() {
    const text = draft.trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user", content: text }];
    setMessages(next);
    setDraft("");
    await runChat(next);
  }

  async function onSubmitRequirements() {
    if (busy) return;
    const merged = { ...answers };
    const summaryParts = [];
    for (const req of pendingRequirements) {
      const agentKey = req.agentKey || req.id || "general";
      merged[agentKey] = { ...(merged[agentKey] || {}) };
      for (const f of req.fields || []) {
        const val = String(reqDraft[`${req.id}.${f.key}`] ?? "").trim();
        if (!val && f.required) {
          setError({ title: "Missing field", detail: `Please fill “${f.label}”.` });
          return;
        }
        if (val) {
          merged[agentKey][f.key] = val;
          summaryParts.push(f.secret ? `${f.label}: (provided)` : `${f.label}: ${val.slice(0, 80)}`);
        }
      }
    }
    setAnswers(merged);
    const next = [
      ...messages,
      { role: "user", content: `Here are the details:\n${summaryParts.join("\n")}` },
    ];
    setMessages(next);
    setPendingRequirements([]);
    await runChat(next, { answers: merged });
  }

  async function onConfirmUnderstanding() {
    const next = [
      ...messages,
      { role: "user", content: "Yes — your understanding is correct. Please design the full architecture." },
    ];
    setMessages(next);
    await runChat(next, { understandingConfirmed: true });
  }

  async function onRejectUnderstanding() {
    const next = [
      ...messages,
      {
        role: "user",
        content: "That understanding needs correction. I’ll clarify in my next messages.",
      },
    ];
    setMessages(next);
    setUnderstanding(null);
    setBlueprint(null);
    await runChat(next, { understandingRejected: true });
  }

  async function onApply() {
    if (!blueprint) return;
    if (
      !window.confirm(
        "Approve & Build this architecture?\n\nRuns simulation approval then creates agents (may charge wallet) and triggers."
      )
    ) {
      return;
    }
    setApplyBusy(true);
    setError(null);
    try {
      // Why: chat already persists a draft id — require simulation gate before create.
      if (!id) {
        res.status(400).json({
          ok: false,
          title: "Blueprint id required",
          detail: "Finish the Architect chat so a draft is saved, then Approve & Build.",
        });
        return;
      }
      setSimBusy(true);
      await api(`/api/architect/${id}/simulate`, {
        method: "POST",
        body: JSON.stringify({ customerCount: 100 }),
      });
      await api(`/api/architect/${id}/approve-simulation`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setSimBusy(false);
      const data = await api("/api/architect/apply", {
        method: "POST",
        body: JSON.stringify({
          blueprintId: id,
          blueprint,
          answers,
          forceBuild: true,
        }),
        timeoutMs: 120_000,
      });
      setCreated(data.created);
      if (data.blueprintId) setBlueprintId(data.blueprintId);
      const list = await api("/api/architect");
      setSavedList(list.blueprints || []);
    } catch (err) {
      setError(err);
    } finally {
      setSimBusy(false);
      setApplyBusy(false);
    }
  }

  function resetAll() {
    setMessages([{ role: "assistant", content: WELCOME }]);
    setDraft("");
    setAnswers({});
    setPendingRequirements([]);
    setReqDraft({});
    setStage("gathering");
    setUnderstanding(null);
    setBlueprint(null);
    setBlueprintId(null);
    setCreated(null);
    setError(null);
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Business Architect</h1>
        <p className="mt-1 text-sm text-teal-900/70">
          Describe a business outcome. I confirm understanding, design the workflow, and only create
          agents/triggers after you approve. Prefer this over thinking in “agents” and “triggers”.
        </p>
        <p className="mt-1 text-xs text-teal-800/60">
          Lighter planner still at{" "}
          <Link className="font-semibold underline" to="/business">
            /business
          </Link>
          .
        </p>
      </div>

      <PageGuideBanner helpId="architect.page" />

      {savedList.length ? (
        <div className="rounded-xl border border-teal-100 bg-teal-50/40 p-3 text-xs">
          <p className="font-bold uppercase tracking-wide text-teal-900/60">Saved businesses</p>
          <ul className="mt-2 flex flex-col gap-1">
            {savedList.slice(0, 8).map((b) => (
              <li key={b._id}>
                <Link className="font-semibold text-teal-800 underline" to={`/architect?id=${b._id}`}>
                  {b.title || b.objective || b._id}
                </Link>{" "}
                <span className="text-teal-800/50">
                  {b.status}
                  {b.agentCount ? ` · ${b.agentCount} agents` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <label className="flex flex-col gap-1 text-sm sm:max-w-md">
        <span className="font-semibold text-teal-950">Planning LLM</span>
        <select
          className="min-h-11 rounded-xl border border-teal-100 bg-white px-3"
          value={profileId}
          onChange={(e) => setProfileId(e.target.value)}
          disabled={busy || applyBusy}
        >
          <option value="">Account settings (default)</option>
          {llmProfiles.map((p) => (
            <option key={p._id} value={p._id}>
              {p.name}
              {p.model ? ` · ${p.model}` : ""}
            </option>
          ))}
        </select>
      </label>

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}

      {created ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-950">
          <h2 className="font-bold">Built</h2>
          <p className="mt-1">{created.summary}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5">
            {(created.agents || []).map((a) => (
              <li key={a._id || a.key}>
                {a._id ? (
                  <Link className="font-semibold underline" to={`/agents/${a._id}`}>
                    {a.name}
                  </Link>
                ) : (
                  a.name
                )}
              </li>
            ))}
          </ul>
          {(created.triggers || []).length ? (
            <p className="mt-2">
              {(created.triggers || []).length} trigger(s) —{" "}
              <Link className="font-semibold underline" to="/operations">
                Operations
              </Link>
            </p>
          ) : null}
          <button
            type="button"
            className="mt-4 min-h-11 rounded-xl border border-emerald-300 bg-white px-4 text-sm font-semibold"
            onClick={resetAll}
          >
            Design another business
          </button>
        </section>
      ) : null}

      {blueprintId && (created || showOps) ? (
        <ArchitectOpsHub
          blueprintId={blueprintId}
          profileId={profileId}
          onError={(err) => setError(err)}
        />
      ) : null}

      {!created ? (
        <>
          <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-teal-800/50">
            Stage: {stage}
          </p>

          <section className="flex max-h-[min(26rem,50vh)] flex-col overflow-hidden rounded-2xl border border-teal-100 bg-white shadow-sm">
            <div className="flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
              {messages.map((m, i) => (
                <div
                  key={`${m.role}-${i}`}
                  className={`max-w-[95%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                    m.role === "user"
                      ? "ml-auto bg-teal-800 text-white"
                      : "bg-teal-50 text-teal-950"
                  }`}
                >
                  {m.content}
                </div>
              ))}
              {busy ? (
                <p className="text-xs font-semibold text-teal-800/60">Architect is thinking…</p>
              ) : null}
              <div ref={bottomRef} />
            </div>

            {pendingRequirements.length ? (
              <div className="border-t border-amber-200 bg-amber-50/80 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-amber-950">
                  Details needed
                </p>
                {pendingRequirements.map((req) => (
                  <div key={req.id} className="mt-3 space-y-2">
                    <div className="text-sm font-semibold text-amber-950">{req.title}</div>
                    {req.detail ? <p className="text-xs text-amber-900/80">{req.detail}</p> : null}
                    {(req.fields || []).map((f) => (
                      <label key={f.key} className="flex flex-col gap-1 text-xs">
                        <span className="font-semibold text-teal-950">{f.label}</span>
                        <input
                          type={f.type === "password" || f.secret ? "password" : "text"}
                          className="min-h-11 rounded-xl border border-amber-200 bg-white px-3 text-sm"
                          placeholder={f.placeholder || ""}
                          value={reqDraft[`${req.id}.${f.key}`] || ""}
                          onChange={(e) =>
                            setReqDraft((prev) => ({
                              ...prev,
                              [`${req.id}.${f.key}`]: e.target.value,
                            }))
                          }
                          autoComplete={f.secret ? "new-password" : "off"}
                        />
                      </label>
                    ))}
                  </div>
                ))}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onSubmitRequirements()}
                  className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-amber-900 px-4 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Submit details
                </button>
              </div>
            ) : null}

            <div className="flex gap-2 border-t border-teal-100 p-3">
              <textarea
                className="min-h-11 flex-1 resize-y rounded-xl border border-teal-100 px-3 py-2 text-sm outline-none focus:border-teal-300"
                rows={2}
                value={draft}
                disabled={busy}
                placeholder="e.g. Contact travel agencies with promo emails and process interested replies…"
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
                disabled={busy || !draft.trim()}
                onClick={() => void onSend()}
                className="inline-flex min-h-11 shrink-0 items-center rounded-xl bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </section>

          {stage === "understanding" && understanding ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-950">
              <h2 className="font-bold">Here’s what I understand</h2>
              {understanding.objective ? (
                <p className="mt-2">
                  <span className="font-semibold">Business objective:</span> {understanding.objective}
                </p>
              ) : null}
              {(understanding.bullets || []).length ? (
                <>
                  <p className="mt-3 font-semibold">My understanding</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {understanding.bullets.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {(understanding.assumptions || []).length ? (
                <>
                  <p className="mt-3 font-semibold">Assumptions</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {understanding.assumptions.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              <p className="mt-3 text-xs">Is my understanding correct?</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onConfirmUnderstanding()}
                  className="inline-flex min-h-11 items-center rounded-xl bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Yes, correct — design it
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onRejectUnderstanding()}
                  className="inline-flex min-h-11 items-center rounded-xl border border-amber-300 bg-white px-4 text-sm font-semibold disabled:opacity-50"
                >
                  Needs correction
                </button>
              </div>
            </section>
          ) : null}

          {stage === "ready" && blueprint ? (
            <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-teal-900/70">
                Architecture blueprint
              </h2>
              <BlueprintPanel blueprint={blueprint} />
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={applyBusy}
                  onClick={() => void onApply()}
                  className="inline-flex min-h-11 items-center rounded-xl border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-950 disabled:opacity-50"
                >
                  {applyBusy || simBusy ? "Simulating & building…" : "Approve & Build"}
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-xl border border-teal-200 px-4 text-sm font-semibold text-teal-900"
                  onClick={() => {
                    setBlueprint(null);
                    setStage("gathering");
                  }}
                >
                  Keep chatting
                </button>
              </div>
            </section>
          ) : null}

          <button
            type="button"
            className="self-start text-xs font-semibold text-teal-700 underline"
            onClick={resetAll}
          >
            Reset
          </button>
        </>
      ) : null}
    </div>
  );
}
