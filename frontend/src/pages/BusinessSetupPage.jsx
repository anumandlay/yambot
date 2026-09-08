/**
 * @fileoverview Business setup — interactive planner chat + LLM profile + confirm create.
 * Purpose: Discuss the workflow in plain English; AI asks for email/API details; show UI map; then build.
 * Downstream: POST /api/business/chat, POST /api/business/apply, GET /api/llm-profiles.
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { PageGuideBanner } from "../components/FieldLabel.jsx";

const PROFILE_KEY = "yambot.business.llmProfileId";

const WELCOME =
  "Describe your business workflow in plain English. I’ll ask for anything I’m missing (email, passwords, API URLs), then show exactly which YamBot pages and fields I’ll use — you confirm before anything is created.";

/**
 * @param {{ plan: object }} props
 */
function PlanPreview({ plan }) {
  return (
    <div className="flex flex-col gap-4">
      {plan.summary ? (
        <p className="rounded-xl border border-teal-100 bg-teal-50/50 px-3 py-2 text-sm leading-relaxed text-teal-950">
          {plan.summary}
        </p>
      ) : null}

      {(plan.explanation || []).length ? (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-teal-900/60">
            What will be set up
          </h3>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-teal-900/85">
            {plan.explanation.map((e, i) => (
              <li key={`${e.title}-${i}`}>
                <span className="font-semibold text-teal-950">{e.title}</span>
                {e.detail ? <span> — {e.detail}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {(plan.uiMap || []).length ? (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-teal-900/60">
            Where in YamBot (learn to do this manually)
          </h3>
          <ul className="mt-2 flex flex-col gap-3">
            {plan.uiMap.map((row, i) => (
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
                    <li key={`${f.label}-${j}`}>
                      <span className="font-semibold">{f.label}:</span> {f.value || "—"}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3 className="text-xs font-bold uppercase tracking-wide text-teal-900/60">Agents</h3>
        <ul className="mt-2 flex flex-col gap-3">
          {(plan.agents || []).map((a) => (
            <li
              key={a.key}
              className="rounded-xl border border-teal-100 bg-white p-3 text-sm shadow-sm"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-bold text-teal-950">{a.name}</span>
                <span className="rounded-md bg-teal-50 px-1.5 py-0.5 font-mono text-[0.65rem] text-teal-800/70">
                  {a.key}
                </span>
                <span className="text-xs text-teal-800/60">{a.role}</span>
              </div>
              {a.description ? (
                <p className="mt-1 text-teal-900/75">{a.description}</p>
              ) : null}
              {a.schedule?.enabled ? (
                <p className="mt-2 text-xs text-amber-900/90">
                  Schedule: {a.schedule.interval}
                  {a.schedule.interval === "daily" ? ` at ${a.schedule.dailyAt} UTC` : ""}
                  {a.schedule.goal ? ` — “${a.schedule.goal}”` : ""}
                </p>
              ) : null}
              {a.needsEmail ? (
                <p className="mt-1 text-xs text-amber-800">
                  Email: {a.email?.fromAddress || "configured via answers / agent Email section"}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {(plan.triggers || []).length ? (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-teal-900/60">Triggers</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {plan.triggers.map((t, i) => (
              <li
                key={`${t.name}-${i}`}
                className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm"
              >
                <div className="font-semibold text-amber-950">{t.name}</div>
                <p className="mt-1 text-xs text-amber-900/80">
                  {t.purpose || "Runs when the condition matches."}
                </p>
                <p className="mt-1 font-mono text-[0.7rem] text-amber-900/70">
                  type={t.type}
                  {t.config?.eventType ? ` · event=${t.config.eventType}` : ""}
                  {" · "}
                  agent={t.agentKey}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {(plan.setupRequired || []).length ? (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-teal-900/60">
            Still needed after create
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-teal-900/80">
            {plan.setupRequired.map((s, i) => (
              <li key={`${s}-${i}`}>{s}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function BusinessSetupPage() {
  const [llmProfiles, setLlmProfiles] = useState([]);
  const [profileId, setProfileId] = useState(() => {
    try {
      return localStorage.getItem(PROFILE_KEY) || "";
    } catch {
      return "";
    }
  });
  /** @type {[{ role: string, content: string }[], Function]} */
  const [messages, setMessages] = useState([{ role: "assistant", content: WELCOME }]);
  const [draft, setDraft] = useState("");
  /** answers[agentKey][fieldKey] = value */
  const [answers, setAnswers] = useState({});
  const [pendingRequirements, setPendingRequirements] = useState([]);
  const [reqDraft, setReqDraft] = useState({});
  const [plan, setPlan] = useState(null);
  const [created, setCreated] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    document.title = "Business setup · YamBot";
    api("/api/llm-profiles")
      .then((data) => setLlmProfiles(data.profiles || []))
      .catch(() => setLlmProfiles([]));
  }, []);

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
  }, [messages, pendingRequirements, plan, busy]);

  /**
   * @param {{ role: string, content: string }[]} nextMessages
   * @param {object} [nextAnswers]
   */
  async function runChat(nextMessages, nextAnswers = answers) {
    setBusy(true);
    setError(null);
    setPlan(null);
    try {
      const data = await api("/api/business/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: nextMessages.filter((m) => m.role === "user" || m.role === "assistant"),
          profileId: profileId || undefined,
          answers: nextAnswers,
        }),
        timeoutMs: 100_000,
      });
      const reply = String(data.assistantMessage || "").trim() || "…";
      setMessages([...nextMessages, { role: "assistant", content: reply }]);
      setPendingRequirements(Array.isArray(data.pendingRequirements) ? data.pendingRequirements : []);
      setReqDraft({});
      if (data.status === "ready" && data.plan) {
        setPlan(data.plan);
      } else {
        setPlan(null);
      }
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

  /**
   * Saves requirement form answers and continues the chat.
   */
  async function onSubmitRequirements() {
    if (busy) return;
    /** @type {Record<string, Record<string, string>>} */
    const merged = { ...answers };
    const summaryParts = [];
    for (const req of pendingRequirements) {
      const agentKey = req.agentKey || req.id || "general";
      merged[agentKey] = { ...(merged[agentKey] || {}) };
      for (const f of req.fields || []) {
        const val = String(reqDraft[`${req.id}.${f.key}`] ?? "").trim();
        if (!val && f.required) {
          setError({
            title: "Missing field",
            detail: `Please fill “${f.label}”.`,
          });
          return;
        }
        if (val) {
          merged[agentKey][f.key] = val;
          summaryParts.push(
            f.secret ? `${f.label}: (provided)` : `${f.label}: ${val.slice(0, 80)}`
          );
        }
      }
    }
    setAnswers(merged);
    const next = [
      ...messages,
      {
        role: "user",
        content: `Here are the details you asked for:\n${summaryParts.join("\n")}`,
      },
    ];
    setMessages(next);
    setPendingRequirements([]);
    await runChat(next, merged);
  }

  async function onApply() {
    if (!plan) return;
    if (
      !window.confirm(
        "Create everything in this plan?\n\nThis creates agents (may charge wallet) and Operations triggers."
      )
    ) {
      return;
    }
    setApplyBusy(true);
    setError(null);
    try {
      const data = await api("/api/business/apply", {
        method: "POST",
        body: JSON.stringify({ plan, answers }),
        timeoutMs: 120_000,
      });
      setCreated(data.created);
    } catch (err) {
      setError(err);
    } finally {
      setApplyBusy(false);
    }
  }

  function resetAll() {
    setMessages([{ role: "assistant", content: WELCOME }]);
    setDraft("");
    setAnswers({});
    setPendingRequirements([]);
    setReqDraft({});
    setPlan(null);
    setCreated(null);
    setError(null);
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Business setup</h1>
        <p className="mt-1 text-sm text-teal-900/70">
          Chat with the planner until the workflow is clear. It asks for email/API details when
          needed, shows which pages and fields it will use, then builds only after you confirm.
        </p>
      </div>

      <PageGuideBanner helpId="business.page" />

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
        <span className="text-xs text-teal-800/60">
          Used only for this planning chat. Manage profiles in{" "}
          <Link className="font-semibold underline" to="/settings/llms">
            Settings → LLMs
          </Link>
          .
        </span>
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
          <h2 className="font-bold">Created</h2>
          <p className="mt-1">{created.summary}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5">
            {(created.agents || []).map((a) => (
              <li key={a._id || a.key}>
                {a._id ? (
                  <>
                    <Link className="font-semibold underline" to={`/agents/${a._id}`}>
                      {a.name}
                    </Link>
                    {" · "}
                    <Link className="font-semibold text-violet-800 underline" to={`/agents/${a._id}/memory`}>
                      View memory
                    </Link>
                  </>
                ) : (
                  a.name
                )}
                {a.scheduleEnabled ? " · scheduled" : ""}
                {a.needsEmail ? " · email" : ""}
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
            Plan another workflow
          </button>
        </section>
      ) : null}

      {!created ? (
        <>
          <section className="flex max-h-[min(28rem,55vh)] flex-col overflow-hidden rounded-2xl border border-teal-100 bg-white shadow-sm">
            <div className="yb-scroll-y flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
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
                <p className="text-xs font-semibold text-teal-800/60">Planner is thinking…</p>
              ) : null}
              <div ref={bottomRef} />
            </div>

            {pendingRequirements.length ? (
              <div className="border-t border-amber-200 bg-amber-50/80 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-amber-950">
                  Fill what the planner needs
                </p>
                {pendingRequirements.map((req) => (
                  <div key={req.id} className="mt-3 space-y-2">
                    <div className="text-sm font-semibold text-amber-950">{req.title}</div>
                    {req.detail ? (
                      <p className="text-xs text-amber-900/80">{req.detail}</p>
                    ) : null}
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
                placeholder="e.g. Check my email every day at 9am…"
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

          {plan ? (
            <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold uppercase tracking-wide text-teal-900/70">
                  Review before create
                </h2>
                <button
                  type="button"
                  className="text-xs font-semibold text-teal-700 underline"
                  onClick={() => setPlan(null)}
                >
                  Keep chatting
                </button>
              </div>
              <PlanPreview plan={plan} />
              <button
                type="button"
                disabled={applyBusy}
                onClick={() => void onApply()}
                className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-950 disabled:opacity-50"
              >
                {applyBusy ? "Creating…" : "Looks good — build it"}
              </button>
            </section>
          ) : null}

          <button
            type="button"
            className="self-start text-xs font-semibold text-teal-700 underline"
            onClick={resetAll}
          >
            Reset conversation
          </button>
        </>
      ) : null}
    </div>
  );
}
