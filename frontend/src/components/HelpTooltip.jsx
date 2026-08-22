/**
 * @fileoverview Contextual help icon with detailed popover/modal.
 * Purpose: Show long-form explanations on click (mobile-friendly); optional link to How To.
 * Downstream: FieldLabel, all pages with helpId props.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getHelp } from "../help/helpContent.js";

/**
 * @param {{
 *   helpId: string,
 *   size?: "sm" | "md",
 *   className?: string,
 * }} props
 */
export function HelpTooltip({ helpId, size = "md", className = "" }) {
  const entry = getHelp(helpId);
  const [open, setOpen] = useState(false);
  const dialogRef = useRef(null);
  const titleId = useId();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, close]);

  if (!entry) return null;

  const sizeClass =
    size === "sm"
      ? "h-6 w-6 min-h-6 min-w-6 text-[0.65rem]"
      : "h-7 w-7 min-h-7 min-w-7 text-xs";

  return (
    <>
      <button
        type="button"
        className={`inline-flex shrink-0 items-center justify-center rounded-full border border-teal-200 bg-teal-50 font-bold leading-none text-teal-800 shadow-sm transition hover:bg-teal-100 focus:outline-none focus:ring-2 focus:ring-teal-500/40 ${sizeClass} ${className}`}
        aria-label={`Help: ${entry.title}`}
        title={`Help: ${entry.title}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        ?
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4"
          role="presentation"
          onClick={close}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="flex max-h-[min(85vh,32rem)] w-full max-w-lg flex-col rounded-t-2xl border border-teal-100 bg-white shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-teal-100 px-4 py-3">
              <h3 id={titleId} className="text-base font-bold text-teal-950 pr-2">
                {entry.title}
              </h3>
              <button
                type="button"
                className="inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-lg border border-teal-100 text-teal-900"
                onClick={close}
                aria-label="Close help"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 text-sm leading-relaxed text-teal-900/90">
              {entry.body.split("\n\n").map((para, i) => (
                <p key={i} className={i > 0 ? "mt-3" : ""}>
                  {para}
                </p>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-teal-100 px-4 py-3">
              {entry.learnMore ? (
                <Link
                  to={`/how-to#${entry.learnMore}`}
                  className="min-h-10 rounded-xl border border-teal-200 px-3 text-sm font-semibold text-teal-800"
                  onClick={close}
                >
                  Read more in How To →
                </Link>
              ) : null}
              <button
                type="button"
                className="min-h-10 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white"
                onClick={close}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
