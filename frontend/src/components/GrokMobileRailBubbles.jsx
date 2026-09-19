/**
 * @fileoverview Mobile-only floating bubbles for grok-style live screen + task queue.
 * Purpose: On small screens, collapse the right rail into two tappable bubbles so the chat
 * thread gets full height; tap opens the panel in a bottom-sheet popup.
 * Downstream: ChatDetailPage when pathname starts with /grok/ (hidden from lg: up).
 */

import { useCallback, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Bottom-sheet popup hosting live screen or task queue content.
 * @param {{
 *   title: string,
 *   onClose: () => void,
 *   children: import("react").ReactNode,
 * }} props
 */
function GrokRailPopup({ title, onClose, children }) {
  const titleId = useId();

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-teal-950/45 p-0 lg:hidden"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[min(88dvh,40rem)] w-full flex-col overflow-hidden rounded-t-2xl border border-teal-100 bg-[#f7f5fc] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-teal-100 bg-white px-4 py-3">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-bold text-teal-950">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-teal-100 text-lg font-bold text-teal-900"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">{children}</div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Floating Live + Queue bubbles for grok mobile; opens panels in popups.
 * @param {{
 *   liveContent: import("react").ReactNode,
 *   queueContent: import("react").ReactNode,
 *   liveActive?: boolean,
 *   liveWaiting?: boolean,
 *   queueCount?: number,
 * }} props
 */
export function GrokMobileRailBubbles({
  liveContent,
  queueContent,
  liveActive = false,
  liveWaiting = false,
  queueCount = 0,
}) {
  const [panel, setPanel] = useState(/** @type {null | "live" | "queue"} */ (null));
  const close = useCallback(() => setPanel(null), []);

  return (
    <>
      {/* Why: sit above the sticky composer; pointer-events only on the bubbles. */}
      <div
        className="pointer-events-none fixed right-3 z-40 flex flex-col items-end gap-2 lg:hidden"
        style={{
          bottom: "max(6.75rem, calc(env(safe-area-inset-bottom, 0px) + 5.5rem))",
        }}
      >
        <button
          type="button"
          onClick={() => setPanel("queue")}
          className="pointer-events-auto relative inline-flex min-h-12 min-w-12 items-center justify-center rounded-full border border-teal-200 bg-white text-lg font-bold text-teal-900 shadow-lg shadow-teal-900/10"
          aria-label={queueCount ? `Task queue, ${queueCount} items` : "Task queue"}
          title="Task queue"
        >
          ≡
          {queueCount > 0 ? (
            <span className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-teal-700 px-1 text-[0.65rem] font-bold text-white">
              {queueCount > 9 ? "9+" : queueCount}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => setPanel("live")}
          className="pointer-events-auto relative inline-flex min-h-12 min-w-12 items-center justify-center rounded-full border border-teal-200 bg-white text-base font-bold text-teal-900 shadow-lg shadow-teal-900/10"
          aria-label={
            liveWaiting ? "Live view, waiting for you" : liveActive ? "Live view, running" : "Live view"
          }
          title="Live view"
        >
          ▣
          {liveActive || liveWaiting ? (
            <span
              className={`absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${
                liveWaiting ? "bg-amber-500" : "animate-pulse bg-emerald-500"
              }`}
              aria-hidden="true"
            />
          ) : null}
        </button>
      </div>

      {panel === "live" ? (
        <GrokRailPopup title="Agent screen" onClose={close}>
          {liveContent}
        </GrokRailPopup>
      ) : null}
      {panel === "queue" ? (
        <GrokRailPopup title="Task status" onClose={close}>
          {queueContent}
        </GrokRailPopup>
      ) : null}
    </>
  );
}
