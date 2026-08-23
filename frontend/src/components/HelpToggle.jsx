/**
 * @fileoverview Toggle control for contextual help and How To visibility.
 * Purpose: User-facing switch in sidebar and mobile header.
 * Downstream: AppSidebar, ProtectedLayout in App.jsx.
 */

import { useHelp } from "../context/HelpContext.jsx";

/**
 * @param {{ compact?: boolean, className?: string }} props
 */
export function HelpToggle({ compact = false, className = "" }) {
  const { helpEnabled, toggleHelp, syncing } = useHelp();

  if (compact) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={helpEnabled}
        aria-label={helpEnabled ? "Turn off help and tooltips" : "Turn on help and tooltips"}
        title={helpEnabled ? "Help on" : "Help off"}
        disabled={syncing}
        onClick={toggleHelp}
        className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border text-sm font-bold transition ${
          helpEnabled
            ? "border-teal-200 bg-teal-50 text-teal-800"
            : "border-teal-100 bg-white text-teal-500"
        } ${className}`}
      >
        ?
      </button>
    );
  }

  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-xl border border-teal-100 bg-teal-50/60 px-3 py-2 ${className}`}
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold text-teal-950">Help & tooltips</div>
        <div className="text-[0.7rem] leading-snug text-teal-900/65">
          {helpEnabled ? "? icons and How To are visible" : "Help is hidden"}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={helpEnabled}
        aria-label={helpEnabled ? "Turn off help and tooltips" : "Turn on help and tooltips"}
        disabled={syncing}
        onClick={toggleHelp}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition ${
          helpEnabled
            ? "border-teal-600 bg-teal-600"
            : "border-teal-200 bg-teal-100"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
            helpEnabled ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}
