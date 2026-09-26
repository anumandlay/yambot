/**
 * @fileoverview Detailed “J” peek for Jev evaluate — question structure + choice breakdown.
 * Purpose: Inspect state, rules, criteria, probabilities, and Gateway answer for an Auto turn.
 * Opens as a centered modal (not clipped by the chat overflow).
 * Downstream: ChatDetailPage next to the Prompt (P) peek.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * @param {string} choice
 * @returns {string}
 */
function prettyChoiceLabel(choice) {
  const c = String(choice || "").trim();
  if (c === "queue_goal") return "computer (queue_goal)";
  if (c === "composio") return "composio";
  if (c === "reply") return "reply";
  return c || "(none)";
}

/**
 * @param {number} n
 * @returns {string}
 */
function pct(n) {
  const v = Number(n) || 0;
  return `${Math.round(v * 1000) / 10}%`;
}

/**
 * @param {{
 *   jev: {
 *     enabled?: boolean,
 *     used?: boolean,
 *     decided?: boolean,
 *     action?: string,
 *     choice?: string,
 *     confidence?: number,
 *     reason?: string,
 *     error?: string,
 *     probabilities?: Record<string, number>,
 *     evaluate?: {
 *       model?: string,
 *       state?: object,
 *       questions?: object,
 *       answer?: object,
 *       usage?: object,
 *     },
 *   } | null | undefined,
 * }} props
 */
export function JevPeek({ jev }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!jev || typeof jev !== "object") return null;
  if (!jev.enabled && !jev.used && !jev.evaluate) return null;

  const choice = String(
    jev.choice || jev.action || jev.evaluate?.answer?.choice || ""
  ).trim();
  const probs =
    (jev.probabilities && typeof jev.probabilities === "object" && jev.probabilities) ||
    (jev.evaluate?.answer?.probabilities &&
    typeof jev.evaluate.answer.probabilities === "object"
      ? jev.evaluate.answer.probabilities
      : {});
  const conf = Number(jev.confidence) || Number(probs[choice]) || 0;
  const confPct = conf > 0 ? pct(conf) : "";
  const state = jev.evaluate?.state && typeof jev.evaluate.state === "object" ? jev.evaluate.state : {};
  const questions =
    jev.evaluate?.questions && typeof jev.evaluate.questions === "object"
      ? jev.evaluate.questions
      : {};
  const actionQ =
    questions.action && typeof questions.action === "object" ? questions.action : null;
  const criteria =
    actionQ?.criteria && typeof actionQ.criteria === "object" ? actionQ.criteria : {};
  const rules = Array.isArray(state.rules) ? state.rules : [];
  const rawAnswer =
    jev.evaluate?.answer?.raw && typeof jev.evaluate.answer.raw === "object"
      ? jev.evaluate.answer.raw
      : null;
  const usage = jev.evaluate?.usage && typeof jev.evaluate.usage === "object" ? jev.evaluate.usage : null;

  const optionKeys = [
    ...new Set([
      ...Object.keys(criteria),
      ...Object.keys(probs),
      ...(choice ? [choice] : []),
    ]),
  ];

  const dump = {
    summary: {
      enabled: Boolean(jev.enabled),
      used: Boolean(jev.used),
      decided: Boolean(jev.decided),
      choice: choice || null,
      confidence: conf || null,
      reason: jev.reason || null,
      error: jev.error || null,
      probabilities: probs,
    },
    evaluate: jev.evaluate || null,
  };
  const text = JSON.stringify(dump, null, 2);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }

  const decidedLabel = !jev.used
    ? "Not called"
    : jev.decided
      ? "Confident decision"
      : "Uncertain / fallback to LLM";

  const modal =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Jev evaluate detail"
          >
            <button
              type="button"
              className="absolute inset-0 bg-slate-900/50"
              aria-label="Close Jev detail"
              onClick={() => setOpen(false)}
            />
            <div className="relative z-10 flex max-h-[min(92dvh,40rem)] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-violet-200 bg-white text-teal-950 shadow-2xl sm:rounded-2xl">
              <div className="flex shrink-0 items-start justify-between gap-2 border-b border-violet-100 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-violet-950">Jev evaluate</p>
                  <p className="mt-0.5 text-[0.75rem] text-teal-900/65">
                    {[
                      jev.evaluate?.model && `model ${jev.evaluate.model}`,
                      decidedLabel,
                      jev.reason && `reason=${jev.reason}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => void copyText()}
                    className="rounded-lg border border-violet-200 px-2.5 py-1.5 text-xs font-semibold text-violet-950 hover:bg-violet-50"
                  >
                    Copy JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-lg border border-violet-200 px-2.5 py-1.5 text-xs font-semibold text-violet-950 hover:bg-violet-50"
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-slate-50 px-4 py-3 text-[0.8rem] leading-relaxed text-slate-800">
                <section
                  className={`rounded-xl border px-3 py-2.5 ${
                    jev.decided
                      ? "border-emerald-200 bg-emerald-50/90"
                      : jev.used
                        ? "border-amber-200 bg-amber-50/90"
                        : "border-slate-200 bg-white"
                  }`}
                >
                  <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">
                    Result
                  </p>
                  <p className="mt-0.5 text-base font-semibold text-slate-900">
                    Chose: {prettyChoiceLabel(choice)}
                    {confPct ? ` (${confPct})` : ""}
                  </p>
                  <p className="mt-0.5 text-[0.75rem] text-slate-600">
                    {decidedLabel}
                    {jev.error ? ` — ${jev.error}` : ""}
                  </p>
                  {optionKeys.length ? (
                    <ul className="mt-3 space-y-2">
                      {optionKeys.map((key) => {
                        const p = Number(probs[key]) || 0;
                        const selected = key === choice;
                        return (
                          <li key={key}>
                            <div className="mb-0.5 flex items-center justify-between gap-2 text-[0.75rem]">
                              <span
                                className={selected ? "font-bold text-violet-900" : "font-medium"}
                              >
                                {prettyChoiceLabel(key)}
                                {selected ? " ← selected" : ""}
                              </span>
                              <span className="tabular-nums text-slate-500">{pct(p)}</span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-slate-200/80">
                              <div
                                className={`h-full rounded-full ${selected ? "bg-violet-600" : "bg-slate-400"}`}
                                style={{
                                  width: `${Math.max(p > 0 ? 4 : 0, Math.min(100, p * 100))}%`,
                                }}
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </section>

                {!jev.evaluate ? (
                  <p className="text-[0.8rem] text-slate-600">
                    {jev.used
                      ? "Jev ran but evaluate payload was not stored on this older message. Send a new message after the latest deploy."
                      : `Jev did not run (${jev.reason || "not_called"}).`}
                  </p>
                ) : (
                  <>
                    <section className="rounded-xl border border-violet-100 bg-white px-3 py-2.5">
                      <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-violet-800">
                        1. State sent to Jev
                      </p>
                      <dl className="mt-2 space-y-2 text-[0.8rem]">
                        {state.product ? (
                          <div>
                            <dt className="font-semibold text-slate-500">product</dt>
                            <dd>{String(state.product)}</dd>
                          </div>
                        ) : null}
                        {state.role ? (
                          <div>
                            <dt className="font-semibold text-slate-500">role</dt>
                            <dd>{String(state.role)}</dd>
                          </div>
                        ) : null}
                        <div>
                          <dt className="font-semibold text-slate-500">user_message</dt>
                          <dd className="mt-0.5 whitespace-pre-wrap break-words rounded-lg bg-slate-50 px-2.5 py-2 text-slate-800">
                            {String(state.user_message || "(empty)")}
                          </dd>
                        </div>
                      </dl>
                      {rules.length ? (
                        <div className="mt-3">
                          <p className="font-semibold text-slate-500">rules ({rules.length})</p>
                          <ol className="mt-1.5 list-decimal space-y-1.5 pl-5 text-[0.78rem] text-slate-700">
                            {rules.map((r, i) => (
                              <li key={i}>{String(r)}</li>
                            ))}
                          </ol>
                        </div>
                      ) : null}
                    </section>

                    <section className="rounded-xl border border-violet-100 bg-white px-3 py-2.5">
                      <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-violet-800">
                        2. Question
                      </p>
                      {actionQ ? (
                        <>
                          <p className="mt-1 text-[0.75rem] text-slate-500">
                            type:{" "}
                            <span className="font-medium text-slate-800">
                              {String(actionQ.type || "choice")}
                            </span>
                            {" · "}
                            id: <span className="font-medium text-slate-800">action</span>
                          </p>
                          <p className="mt-2 whitespace-pre-wrap text-[0.8rem] text-slate-800">
                            {String(actionQ.instructions || "")}
                          </p>
                        </>
                      ) : (
                        <p className="mt-1 text-slate-500">No question payload.</p>
                      )}
                    </section>

                    <section className="rounded-xl border border-violet-100 bg-white px-3 py-2.5">
                      <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-violet-800">
                        3. Criteria (options)
                      </p>
                      <div className="mt-2 space-y-2.5">
                        {Object.keys(criteria).length ? (
                          Object.entries(criteria).map(([key, val]) => {
                            const selected = key === choice;
                            return (
                              <div
                                key={key}
                                className={`rounded-lg border px-3 py-2.5 ${
                                  selected
                                    ? "border-violet-400 bg-violet-50"
                                    : "border-slate-200 bg-slate-50/80"
                                }`}
                              >
                                <p className="text-[0.8rem] font-semibold text-slate-900">
                                  {prettyChoiceLabel(key)}
                                  {selected ? " ← Jev picked this" : ""}
                                  {probs[key] != null ? (
                                    <span className="ml-1 font-normal text-slate-500">
                                      ({pct(Number(probs[key]))})
                                    </span>
                                  ) : null}
                                </p>
                                <p className="mt-1.5 whitespace-pre-wrap text-[0.78rem] text-slate-700">
                                  {String(val)}
                                </p>
                              </div>
                            );
                          })
                        ) : (
                          <p className="text-slate-500">No criteria on this message.</p>
                        )}
                      </div>
                    </section>

                    {rawAnswer && Object.keys(rawAnswer).length > 2 ? (
                      <section className="rounded-xl border border-violet-100 bg-white px-3 py-2.5">
                        <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-violet-800">
                          4. Gateway answer fields
                        </p>
                        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2.5 font-mono text-[0.7rem] text-slate-700">
                          {JSON.stringify(rawAnswer, null, 2)}
                        </pre>
                      </section>
                    ) : null}

                    {usage && (usage.totalTokens || usage.promptTokens) ? (
                      <p className="text-[0.75rem] text-slate-500">
                        Tokens: prompt {usage.promptTokens ?? "—"} · completion{" "}
                        {usage.completionTokens ?? "—"} · total {usage.totalTokens ?? "—"}
                      </p>
                    ) : null}
                  </>
                )}

                <details className="rounded-xl border border-violet-100 bg-white px-3 py-2.5" open>
                  <summary className="cursor-pointer text-[0.75rem] font-semibold text-violet-900">
                    Full JSON (copyable)
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[0.7rem] text-slate-700">
                    {text}
                  </pre>
                </details>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="relative z-10 shrink-0 self-start">
      <button
        type="button"
        title={
          [choice ? `chose ${choice}` : null, confPct || null, jev.reason ? `reason=${jev.reason}` : null]
            .filter(Boolean)
            .join(" · ") || "View Jev evaluate for this message"
        }
        onClick={() => setOpen(true)}
        aria-label="View Jev evaluate question and choice"
        className="flex h-4 w-4 items-center justify-center rounded-sm border border-violet-300 bg-white text-[10px] font-semibold leading-none text-violet-900 shadow-sm hover:bg-violet-50 sm:h-2.5 sm:w-2.5 sm:text-[8px] sm:font-medium sm:shadow-none"
      >
        J
      </button>
      {modal}
    </div>
  );
}
