/**
 * @fileoverview Shared alert banner for API / form errors.
 * Purpose: Surface title + detail + hint clearly (mirrors extension UX).
 * Downstream: Login, Settings, Chat pages.
 */

/**
 * @param {{ title?: string, detail?: string, hint?: string, onClose?: () => void }} props
 */
export function ErrorAlert({ title = "Error", detail, hint, onClose }) {
  if (!detail && !title) return null;
  return (
    <div
      role="alert"
      className="w-full rounded-xl border border-red-200 bg-red-50 p-3 text-left shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <strong className="text-red-700">{title}</strong>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 min-w-11 rounded-lg border border-red-200 px-2 text-sm text-red-700"
          >
            Dismiss
          </button>
        ) : null}
      </div>
      {detail ? <p className="mt-1 whitespace-pre-wrap text-sm text-red-900">{detail}</p> : null}
      {hint ? <p className="mt-2 text-xs text-red-700/80">{hint}</p> : null}
    </div>
  );
}
