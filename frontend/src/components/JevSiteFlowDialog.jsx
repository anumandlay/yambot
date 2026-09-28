/**
 * @fileoverview Popup of saved Jev cases for one website and the step flow.
 * Purpose: Agent → Jev groups site paths by host; this dialog lists each goal and its steps.
 * Inputs: host, plays (public sitePlays for that host), onClose, onDelete.
 * Downstream: AgentEditPage site-paths section.
 */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * One step as a short flow line. Passwords are a flag only.
 * @param {{ op?: string, url?: string, name?: string, text?: string, secret?: string }} step
 * @returns {string}
 */
export function jevSiteStepLabel(step) {
  const op = String(step?.op || "");
  const name = String(step?.name || "").trim();
  if (op === "goto") {
    const url = String(step?.url || "").trim();
    return url ? `Open ${url}` : "Open page";
  }
  if (op === "click") return `Click ${name || "element"}`;
  if (op === "fill") {
    if (step?.secret === "password") {
      return `Fill ${name || "password"} (password, not stored)`;
    }
    const text = String(step?.text || "").trim();
    if (text) return `Fill ${name || "field"}: ${text}`;
    return `Fill ${name || "field"}`;
  }
  return name || op || "Step";
}

/**
 * @param {object[]} plays
 * @returns {{ host: string, items: object[] }[]}
 */
export function groupJevSitePlays(plays) {
  /** @type {Map<string, object[]>} */
  const map = new Map();
  for (const play of Array.isArray(plays) ? plays : []) {
    const host = String(play?.host || "site").trim() || "site";
    const list = map.get(host) || [];
    list.push(play);
    map.set(host, list);
  }
  return [...map.entries()].map(([host, items]) => ({
    host,
    items: items.slice().sort((a, b) => {
      const ta = a?.at ? new Date(a.at).getTime() : 0;
      const tb = b?.at ? new Date(b.at).getTime() : 0;
      return tb - ta;
    }),
  }));
}

/**
 * @param {{
 *   host: string,
 *   plays: object[],
 *   busy?: boolean,
 *   onClose: () => void,
 *   onDelete?: (playId: string) => void,
 * }} props
 */
export function JevSiteFlowDialog({ host, plays, busy = false, onClose, onDelete }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, []);

  const items = Array.isArray(plays) ? plays : [];
  const modal = (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Jev cases for ${host}`}
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/50"
        aria-label="Close site flow"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[min(92dvh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-violet-200 bg-white text-teal-950 shadow-2xl sm:rounded-2xl">
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-violet-100 px-4 py-3">
          <div className="min-w-0">
            <p className="text-base font-semibold text-violet-950">{host}</p>
            <p className="mt-0.5 text-xs text-teal-900/65">
              {items.length} saved {items.length === 1 ? "case" : "cases"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-teal-100 px-3 text-sm font-semibold text-teal-900"
          >
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {items.length === 0 ? (
            <p className="text-sm text-teal-900/60">No saved cases for this site.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {items.map((play) => {
                const steps = Array.isArray(play.steps) ? play.steps : [];
                const when = play.at ? new Date(play.at) : null;
                return (
                  <li
                    key={play.id || play.goalSample}
                    className="rounded-xl border border-violet-100 bg-violet-50/40 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="whitespace-pre-wrap break-words text-sm font-medium text-teal-950">
                          {String(play.goalSample || "Saved path")}
                        </p>
                        <p className="mt-1 text-[0.7rem] text-teal-900/55">
                          {Number(play.hits) > 0 ? `Used ${Number(play.hits)}×` : "Saved"}
                          {when && !Number.isNaN(when.getTime())
                            ? ` · ${when.toLocaleString()}`
                            : ""}
                          {play.handoff === "summarize" ? " · then summarize the page" : ""}
                        </p>
                      </div>
                      {play.id && onDelete ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onDelete(String(play.id))}
                          className="shrink-0 rounded-lg border border-red-200 bg-white px-2 py-1 text-[0.65rem] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                    {steps.length === 0 ? (
                      <p className="mt-2 text-xs text-teal-900/55">No steps stored.</p>
                    ) : (
                      <ol className="mt-2 flex flex-col gap-1.5">
                        {steps.map((step, i) => (
                          <li key={`${play.id}-${i}`} className="flex gap-2 text-sm text-teal-950">
                            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[0.65rem] font-semibold text-violet-900">
                              {i + 1}
                            </span>
                            <span className="min-w-0 break-words">{jevSiteStepLabel(step)}</span>
                          </li>
                        ))}
                        {play.handoff === "summarize" ? (
                          <li className="flex gap-2 text-sm text-teal-950">
                            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[0.65rem] font-semibold text-violet-900">
                              {steps.length + 1}
                            </span>
                            <span>Read the live page and summarize</span>
                          </li>
                        ) : null}
                      </ol>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}
