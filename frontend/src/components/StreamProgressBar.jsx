/**
 * @fileoverview Tiny progress bar for in-flight Auto / Composio chat turns.
 * Purpose: Show a slim labeled bar under the streaming assistant bubble while Composio tools run.
 * Downstream: ChatDetailPage optimistic stream rows (meta.streaming / meta.progress).
 */

/**
 * @param {{
 *   label?: string,
 *   pct?: number,
 *   indeterminate?: boolean,
 * }} props
 */
export function StreamProgressBar({ label = "Working…", pct = 0, indeterminate = false }) {
  const value = Math.max(0, Math.min(100, Number(pct) || 0));
  const showIndeterminate = indeterminate || value <= 0;
  return (
    <div className="mt-2 w-full max-w-[14rem]" aria-live="polite" aria-busy="true">
      <p className="mb-1 truncate text-[0.65rem] font-medium text-teal-900/75">{label}</p>
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
    </div>
  );
}
