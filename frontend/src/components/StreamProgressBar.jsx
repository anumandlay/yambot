/**
 * @fileoverview Tiny progress bar for in-flight Auto / Composio chat turns.
 * Purpose: Show a slim labeled bar under the assistant bubble; click to expand the step log.
 * Downstream: ChatDetailPage optimistic stream rows + durable hermesTiming.progressLog.
 */

import { useState } from "react";

/**
 * @param {{
 *   label?: string,
 *   pct?: number,
 *   indeterminate?: boolean,
 *   steps?: { id?: string, label?: string, pct?: number, at?: number, detail?: string }[],
 *   active?: boolean,
 * }} props
 */
export function StreamProgressBar({
  label = "Working…",
  pct = 0,
  indeterminate = false,
  steps = [],
  active = false,
}) {
  const [open, setOpen] = useState(false);
  const value = Math.max(0, Math.min(100, Number(pct) || 0));
  const showIndeterminate = indeterminate || (active && value <= 0);
  const list = Array.isArray(steps) ? steps.filter((s) => s && (s.label || s.detail)) : [];
  const hasDetails = list.length > 0;

  return (
    <div className="mt-2 w-full max-w-md" aria-live="polite" aria-busy={active ? "true" : undefined}>
      <button
        type="button"
        onClick={() => {
          if (hasDetails) setOpen((v) => !v);
        }}
        className={`w-full text-left ${hasDetails ? "cursor-pointer" : "cursor-default"}`}
        title={hasDetails ? (open ? "Hide steps" : "Show what it’s doing") : label}
        aria-expanded={hasDetails ? open : undefined}
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="truncate text-[0.65rem] font-medium text-teal-900/80">
            {label}
            {hasDetails ? (
              <span className="ml-1 font-normal text-teal-900/50">
                {open ? "▾ details" : "▸ details"}
              </span>
            ) : null}
          </p>
          {!showIndeterminate && value > 0 ? (
            <span className="shrink-0 text-[0.6rem] tabular-nums text-teal-900/55">{value}%</span>
          ) : null}
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-teal-900/10"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={showIndeterminate ? undefined : value}
          aria-label={label}
        >
          {showIndeterminate ? (
            <div className="h-full w-2/5 animate-pulse rounded-full bg-teal-600/80" />
          ) : (
            <div
              className="h-full rounded-full bg-teal-700 transition-[width] duration-300 ease-out"
              style={{ width: `${Math.max(6, value)}%` }}
            />
          )}
        </div>
      </button>
      {open && hasDetails ? (
        <ol className="mt-2 max-h-48 list-decimal space-y-1.5 overflow-y-auto rounded-lg border border-teal-100 bg-white/90 py-2 pl-6 pr-2 text-[0.65rem] text-teal-950 shadow-sm">
          {list.map((s, i) => (
            <li key={`${s.id || "step"}-${i}-${s.at || 0}`} className="leading-snug">
              <span className="font-medium">{String(s.label || "Step")}</span>
              {s.detail ? (
                <span className="mt-0.5 block whitespace-pre-wrap break-words text-teal-900/65">
                  {String(s.detail)}
                </span>
              ) : null}
              {s.at != null && Number(s.at) > 0 ? (
                <span className="mt-0.5 block tabular-nums text-teal-900/40">
                  +{(Number(s.at) / 1000).toFixed(1)}s
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
