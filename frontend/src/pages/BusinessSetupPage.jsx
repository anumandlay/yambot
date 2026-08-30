/**
 * @fileoverview Business setup — plain-English brief → AI plan preview → confirm create.
 * Purpose: Let users describe a multi-agent workflow; show agents/triggers/schedules before apply.
 * Downstream: POST /api/business/plan, POST /api/business/apply.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { PageGuideBanner } from "../components/FieldLabel.jsx";

const EXAMPLE = `I need one agent that pulls customer emails from our API (GET), sends a promotional email, then POSTs status back to the same API.

Every day at 9am, check my inbox for replies.

When a customer replies, a second agent should start follow-up work (qualify the lead and update CRM).`;

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
            What the AI will set up
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
                <p className="mt-1 text-xs text-amber-800">Needs SMTP/IMAP configured after create.</p>
              ) : null}
              {(a.policy?.httpAllowHosts || []).length ? (
                <p className="mt-1 font-mono text-[0.7rem] text-teal-800/70">
                  HTTP allow: {(a.policy.httpAllowHosts || []).join(", ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {(plan.triggers || []).length ? (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-teal-900/60">
            Triggers
          </h3>
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
                  {" · "}
                  action={t.action}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {(plan.apis || []).length ? (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-teal-900/60">
            API steps
          </h3>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {plan.apis.map((apiRow, i) => (
              <li key={`${apiRow.hostHint}-${i}`} className="rounded-xl border border-teal-100 p-3">
                <span className="font-mono text-xs font-semibold">{apiRow.method}</span>{" "}
                <span className="font-mono text-xs">
                  {apiRow.hostHint}
                  {apiRow.pathHint || ""}
                </span>
                <p className="mt-1 text-teal-900/75">{apiRow.purpose}</p>
                {apiRow.notes ? (
                  <p className="mt-1 text-xs text-teal-800/60">{apiRow.notes}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {(plan.setupRequired || []).length ? (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-teal-900/60">
            You still need to provide
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
  const [brief, setBrief] = useState("");
  const [plan, setPlan] = useState(null);
  const [created, setCreated] = useState(null);
  const [error, setError] = useState(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);

  /**
   * Asks the LLM for a plan only — nothing is created yet.
   */
  async function onPlan() {
    setError(null);
    setCreated(null);
    setPlan(null);
    setPlanBusy(true);
    try {
      const data = await api("/api/business/plan", {
        method: "POST",
        body: JSON.stringify({ brief }),
        timeoutMs: 100_000,
      });
      setPlan(data.plan);
    } catch (err) {
      setError(err);
    } finally {
      setPlanBusy(false);
    }
  }

  /**
   * Creates agents + triggers from the preview the user reviewed.
   */
  async function onApply() {
    if (!plan) return;
    if (
      !window.confirm(
        "Create everything in this plan?\n\nThis will create agents (and may charge your wallet) plus Operations triggers."
      )
    ) {
      return;
    }
    setError(null);
    setApplyBusy(true);
    try {
      const data = await api("/api/business/apply", {
        method: "POST",
        body: JSON.stringify({ plan }),
        timeoutMs: 120_000,
      });
      setCreated(data.created);
    } catch (err) {
      setError(err);
    } finally {
      setApplyBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Business setup</h1>
        <p className="mt-1 text-sm text-teal-900/70">
          Describe your workflow in plain English. The AI proposes agents, schedules, and triggers —
          you review, then confirm before anything is built.
        </p>
      </div>

      <PageGuideBanner helpId="business.page" />

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
                  <Link className="font-semibold underline" to={`/agents/${a._id}`}>
                    {a.name}
                  </Link>
                ) : (
                  a.name
                )}
                {a.scheduleEnabled ? " · scheduled" : ""}
                {a.needsEmail ? " · configure email" : ""}
              </li>
            ))}
          </ul>
          {(created.triggers || []).length ? (
            <p className="mt-2">
              {(created.triggers || []).length} trigger(s) — see{" "}
              <Link className="font-semibold underline" to="/operations">
                Operations
              </Link>
              .
            </p>
          ) : null}
          {(created.setupRequired || []).length ? (
            <ul className="mt-3 list-disc space-y-1 border-t border-emerald-200/80 pt-3 pl-5 text-xs">
              {created.setupRequired.map((s, i) => (
                <li key={`${s}-${i}`}>{s}</li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            className="mt-4 min-h-11 rounded-xl border border-emerald-300 bg-white px-4 text-sm font-semibold"
            onClick={() => {
              setCreated(null);
              setPlan(null);
            }}
          >
            Plan another workflow
          </button>
        </section>
      ) : null}

      {!created ? (
        <>
          <label className="flex flex-col gap-2 text-sm">
            <span className="font-semibold text-teal-950">Business idea</span>
            <textarea
              className="min-h-[14rem] w-full rounded-2xl border border-teal-100 bg-white px-3 py-3 text-sm leading-relaxed shadow-sm outline-none focus:border-teal-300"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder={EXAMPLE}
            />
            <button
              type="button"
              className="self-start text-xs font-semibold text-teal-700 underline"
              onClick={() => setBrief(EXAMPLE)}
            >
              Insert example brief
            </button>
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={planBusy || brief.trim().length < 20}
              onClick={() => void onPlan()}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {planBusy ? "Planning…" : "Show me the plan"}
            </button>
            {plan ? (
              <button
                type="button"
                disabled={applyBusy || planBusy}
                onClick={() => void onApply()}
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-950 disabled:opacity-50"
              >
                {applyBusy ? "Creating…" : "Looks good — build it"}
              </button>
            ) : null}
          </div>

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
                  Discard plan
                </button>
              </div>
              <PlanPreview plan={plan} />
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
