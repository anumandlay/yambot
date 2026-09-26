/**
 * @fileoverview Small “J” bubble beside a chat message to inspect the Jev evaluate call.
 * Purpose: Show the question structure (state + criteria) and which choice Jev picked.
 * Downstream: ChatDetailPage next to the Prompt (P) peek.
 */

import { useState } from "react";

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
 *       answer?: { choice?: string, probabilities?: Record<string, number> },
 *     },
 *   } | null | undefined,
 * }} props
 */
export function JevPeek({ jev }) {
  const [open, setOpen] = useState(false);
  if (!jev || typeof jev !== "object") return null;
  if (!jev.enabled && !jev.used && !jev.evaluate) return null;

  const choice = String(jev.choice || jev.action || jev.evaluate?.answer?.choice || "").trim();
  const probs =
    (jev.probabilities && typeof jev.probabilities === "object" && jev.probabilities) ||
    (jev.evaluate?.answer?.probabilities &&
    typeof jev.evaluate.answer.probabilities === "object"
      ? jev.evaluate.answer.probabilities
      : {});
  const conf = Number(jev.confidence) || Number(probs[choice]) || 0;
  const confPct = conf > 0 ? `${Math.round(conf * 100)}%` : "";
  const titleBits = [
    choice ? `chose ${choice}` : null,
    confPct || null,
    jev.reason ? `reason=${jev.reason}` : null,
  ].filter(Boolean);
  const title = titleBits.join(" · ") || "View Jev evaluate for this message";

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

  const prettyChoice =
    choice === "queue_goal"
      ? "computer"
      : choice === "composio"
        ? "composio"
        : choice === "reply"
          ? "reply"
          : choice || "?";

  return (
    <div className="relative z-10 shrink-0 self-start">
      <button
        type="button"
        title={title}
        onClick={() => setOpen((v) => !v)}
        aria-label="View Jev evaluate question and choice"
        className="flex h-4 w-4 items-center justify-center rounded-sm border border-violet-300 bg-white text-[10px] font-semibold leading-none text-violet-900 shadow-sm hover:bg-violet-50 sm:h-2.5 sm:w-2.5 sm:text-[8px] sm:font-medium sm:shadow-none"
      >
        J
      </button>
      {open ? (
        <div className="absolute right-0 z-40 mt-1 w-[min(calc(100vw-1.5rem),28rem)] max-w-[min(92vw,28rem)] overflow-hidden rounded-xl border border-violet-200 bg-white text-teal-950 shadow-lg">
          <div className="flex items-center justify-between gap-2 border-b border-violet-100 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold">Jev evaluate</p>
              <p className="truncate text-[0.65rem] text-teal-900/60">
                {[
                  jev.evaluate?.model && `model=${jev.evaluate.model}`,
                  `choice=${prettyChoice}`,
                  confPct && confPct,
                  jev.reason,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => void copyText()}
                className="rounded-lg border border-violet-200 px-2 py-1 text-[0.65rem] font-semibold text-violet-950 hover:bg-violet-50"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-violet-200 px-2 py-1 text-[0.65rem] font-semibold text-violet-950 hover:bg-violet-50"
              >
                Close
              </button>
            </div>
          </div>
          <div className="max-h-80 overflow-auto bg-slate-50 px-3 py-2 font-mono text-[0.65rem] leading-relaxed text-slate-800">
            {jev.evaluate?.questions?.action ? (
              <section className="mb-3">
                <p className="mb-1 font-sans text-[0.7rem] font-semibold text-violet-900">
                  Question
                </p>
                <p className="mb-2 whitespace-pre-wrap font-sans text-[0.7rem] text-slate-700">
                  {String(jev.evaluate.questions.action.instructions || "")}
                </p>
                <p className="mb-1 font-sans text-[0.7rem] font-semibold text-violet-900">
                  Criteria
                </p>
                <ul className="mb-2 list-disc space-y-1 pl-4 font-sans text-[0.7rem] text-slate-700">
                  {Object.entries(jev.evaluate.questions.action.criteria || {}).map(
                    ([key, val]) => (
                      <li key={key}>
                        <span className="font-semibold">{key}</span>: {String(val)}
                      </li>
                    )
                  )}
                </ul>
                {jev.evaluate.state?.user_message ? (
                  <>
                    <p className="mb-1 font-sans text-[0.7rem] font-semibold text-violet-900">
                      User message
                    </p>
                    <p className="mb-2 whitespace-pre-wrap break-words font-sans text-[0.7rem] text-slate-700">
                      {String(jev.evaluate.state.user_message)}
                    </p>
                  </>
                ) : null}
                <p className="mb-1 font-sans text-[0.7rem] font-semibold text-violet-900">
                  Choice
                </p>
                <p className="mb-2 font-sans text-[0.7rem] text-slate-700">
                  <span className="font-semibold">{prettyChoice || "(none)"}</span>
                  {Object.keys(probs).length
                    ? ` — ${Object.entries(probs)
                        .map(([k, v]) => `${k} ${Math.round(Number(v) * 100)}%`)
                        .join(", ")}`
                    : confPct
                      ? ` — ${confPct}`
                      : ""}
                </p>
              </section>
            ) : (
              <p className="mb-2 font-sans text-[0.7rem] text-slate-600">
                {jev.used
                  ? "Jev ran but evaluate payload was not stored on this message."
                  : `Jev did not run (${jev.reason || "not_called"}).`}
              </p>
            )}
            <details className="mt-1">
              <summary className="cursor-pointer font-sans text-[0.65rem] font-semibold text-violet-900">
                Full JSON
              </summary>
              <pre className="mt-1 whitespace-pre-wrap break-words">{text}</pre>
            </details>
          </div>
        </div>
      ) : null}
    </div>
  );
}
