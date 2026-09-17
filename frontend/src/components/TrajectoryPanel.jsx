/**
 * @fileoverview Task trajectory replay — compact step chain for debugging runs.
 * Purpose: Show agent steps under the live screen as an icon + drawer (or expandable panel).
 * Downstream: ChatDetailPage; Task.trajectory.
 */

import { useMemo, useState } from "react";
import { SectionTitle } from "./FieldLabel.jsx";

/**
 * Builds trajectory rows from stored trajectory or live step events.
 * @param {object|null} task
 * @returns {object[]}
 */
export function trajectoryRowsFromTask(task) {
  if (!task) return [];
  if (Array.isArray(task.trajectory) && task.trajectory.length) {
    return task.trajectory.map((row, i) => ({
      key: `t-${i}`,
      step: row.step ?? i + 1,
      type: row.action?.type || "—",
      ref: row.action?.ref || row.action?.name || "",
      ok: row.ok !== false,
      failure: row.failure_class || "",
    }));
  }
  return (task.events || [])
    .filter((e) => e.type === "step" && e.payload?.action)
    .map((e, i) => ({
      key: `e-${i}`,
      step: e.payload?.step ?? i + 1,
      type: e.payload.action?.type || "—",
      ref: e.payload.action?.ref || e.payload.action?.name || "",
      ok:
        e.payload?.result?.ok !== false &&
        e.payload?.result?.verification?.passed !== false,
      failure: e.payload?.result?.failure_class || "",
    }));
}

/**
 * Path / steps glyph for the compact icon control.
 * @returns {JSX.Element}
 */
function TrajectoryIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M3 4.75A.75.75 0 0 1 3.75 4h12.5a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 4.75ZM3 10a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 3 10Zm0 5.25a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z" />
    </svg>
  );
}

/**
 * @param {{
 *   task?: object|null,
 *   className?: string,
 *   variant?: "panel"|"icon"|"drawer",
 *   open?: boolean,
 *   onOpenChange?: (open: boolean) => void,
 * }} props
 */
export function TrajectoryPanel({
  task,
  className = "",
  variant = "panel",
  open: openProp,
  onOpenChange,
}) {
  const rows = useMemo(() => trajectoryRowsFromTask(task), [task]);
  const [openLocal, setOpenLocal] = useState(false);
  const open = openProp !== undefined ? Boolean(openProp) : openLocal;
  const failed = rows.filter((r) => !r.ok).length;

  /**
   * @param {boolean} next
   */
  function setOpen(next) {
    if (onOpenChange) onOpenChange(next);
    else setOpenLocal(next);
  }

  /**
   * Shared table body.
   * @returns {JSX.Element}
   */
  function renderBody() {
    if (!rows.length) {
      return (
        <p className="px-3 py-2 text-xs text-teal-900/60">Waiting for agent steps…</p>
      );
    }
    return (
      <div className="max-h-40 overflow-auto p-2">
        <table className="min-w-full font-mono text-[0.68rem]">
          <thead className="text-teal-900/60">
            <tr>
              <th className="px-1 py-0.5 text-left">#</th>
              <th className="px-1 py-0.5 text-left">action</th>
              <th className="px-1 py-0.5 text-left">target</th>
              <th className="px-1 py-0.5 text-left">ok</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-teal-50 align-top">
                <td className="px-1 py-0.5">{r.step}</td>
                <td className="px-1 py-0.5">{r.type}</td>
                <td className="max-w-[8rem] truncate px-1 py-0.5" title={r.ref}>
                  {r.ref || "—"}
                </td>
                <td className="px-1 py-0.5">
                  {r.ok ? (
                    <span className="text-emerald-700">✓</span>
                  ) : (
                    <span className="text-red-600" title={r.failure}>
                      ✗{r.failure ? ` ${r.failure}` : ""}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-teal-900 ${
          open
            ? "border-teal-500 bg-teal-100"
            : "border-teal-200 bg-white hover:bg-teal-50"
        } ${className}`}
        title="Trajectory"
        aria-label="Trajectory"
        aria-pressed={open}
      >
        <TrajectoryIcon />
        {rows.length ? (
          <span
            className={`absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 text-[0.55rem] font-bold text-white ${
              failed ? "bg-red-600" : "bg-teal-700"
            }`}
          >
            {rows.length > 9 ? "9+" : rows.length}
          </span>
        ) : null}
      </button>
    );
  }

  if (variant === "drawer") {
    return (
      <div
        className={`overflow-hidden rounded-2xl border border-teal-100 bg-white shadow-sm ${className}`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-teal-50 px-3 py-2">
          <SectionTitle as="span" helpId="chat.trajectory" className="inline-flex text-xs">
            Trajectory
            {rows.length ? (
              <span className="ml-2 font-mono font-normal text-teal-800/70">
                {rows.length} steps{failed ? ` · ${failed} failed` : ""}
              </span>
            ) : null}
          </SectionTitle>
        </div>
        {renderBody()}
      </div>
    );
  }

  const shellClass = `flex shrink-0 flex-col overflow-hidden rounded-2xl border border-teal-100 bg-white shadow-sm ${className}`;

  return (
    <details
      className={shellClass}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer list-none px-3 py-2 [&::-webkit-details-marker]:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <SectionTitle as="span" helpId="chat.trajectory" className="inline-flex">
              Trajectory
            </SectionTitle>
            {rows.length ? (
              <span className="ml-2 rounded-lg bg-teal-50 px-2 py-0.5 font-mono text-xs text-teal-800">
                {rows.length} steps
                {failed ? ` · ${failed} failed` : ""}
              </span>
            ) : (
              <span className="ml-2 text-xs font-normal text-teal-800/50">
                waiting for agent steps…
              </span>
            )}
          </div>
        </div>
      </summary>
      <div className="border-t border-teal-50">{renderBody()}</div>
    </details>
  );
}
