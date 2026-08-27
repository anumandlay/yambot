/**
 * @fileoverview Outcome branches editor — LLM result routing config for goals and triggers.
 * Purpose: Configure if/else-style branches (event types) classified from agent result text.
 * Downstream: GoalEditPage, OperationsPage trigger form.
 */

import { FieldLabel } from "./FieldLabel.jsx";

const EMPTY_BRANCH = { label: "", eventType: "", description: "" };

/**
 * @param {{
 *   enabled: boolean,
 *   onEnabledChange: (v: boolean) => void,
 *   branches: { label: string, eventType: string, description: string }[],
 *   onBranchesChange: (branches: { label: string, eventType: string, description: string }[]) => void,
 *   helpIdEnabled?: string,
 *   helpIdBranch?: string,
 *   className?: string,
 * }} props
 */
export function OutcomeBranchesEditor({
  enabled,
  onEnabledChange,
  branches,
  onBranchesChange,
  helpIdEnabled = "ops.outcomeRouting",
  helpIdBranch = "ops.outcomeBranch",
  className = "",
}) {
  const rows = branches.length ? branches : [{ ...EMPTY_BRANCH }];

  /**
   * @param {number} index
   * @param {string} field
   * @param {string} value
   */
  function updateRow(index, field, value) {
    const next = rows.map((row, i) => (i === index ? { ...row, [field]: value } : row));
    onBranchesChange(next);
  }

  function addRow() {
    if (rows.length >= 12) return;
    onBranchesChange([...rows, { ...EMPTY_BRANCH }]);
  }

  /**
   * @param {number} index
   */
  function removeRow(index) {
    const next = rows.filter((_, i) => i !== index);
    onBranchesChange(next.length ? next : [{ ...EMPTY_BRANCH }]);
  }

  return (
    <div className={`flex flex-col gap-2 rounded-xl border border-violet-100 bg-violet-50/40 p-3 ${className}`}>
      <label className="flex items-center gap-2 text-sm font-medium text-teal-950">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className="h-4 w-4 rounded border-violet-200"
        />
        <FieldLabel helpId={helpIdEnabled}>LLM outcome routing (result-based)</FieldLabel>
      </label>
      <p className="text-xs text-teal-900/60">
        After the task finishes, your LLM reads the agent&apos;s reply and emits one branch event — in
        addition to success/failure completion events above.
      </p>
      {enabled ? (
        <div className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <div
              key={`branch-${index}`}
              className="grid grid-cols-1 gap-2 rounded-lg border border-violet-100 bg-white p-2 sm:grid-cols-2"
            >
              <label className="flex flex-col gap-1 text-xs">
                <FieldLabel helpId={helpIdBranch} className="text-xs">
                  Label
                </FieldLabel>
                <input
                  className="min-h-9 rounded-lg border border-teal-100 px-2 text-sm"
                  value={row.label}
                  onChange={(e) => updateRow(index, "label", e.target.value)}
                  placeholder="Cold weather"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-teal-950">Emit event type</span>
                <input
                  className="min-h-9 rounded-lg border border-teal-100 px-2 font-mono text-sm"
                  value={row.eventType}
                  onChange={(e) => updateRow(index, "eventType", e.target.value)}
                  placeholder="weather.cold"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs sm:col-span-2">
                <span className="font-medium text-teal-950">When (for LLM)</span>
                <input
                  className="min-h-9 rounded-lg border border-teal-100 px-2 text-sm"
                  value={row.description}
                  onChange={(e) => updateRow(index, "description", e.target.value)}
                  placeholder="Temperature below 50°F in the result"
                />
              </label>
              {rows.length > 1 ? (
                <div className="sm:col-span-2">
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    className="text-xs font-semibold text-red-700 underline"
                  >
                    Remove branch
                  </button>
                </div>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            onClick={addRow}
            disabled={rows.length >= 12}
            className="self-start text-xs font-semibold text-violet-800 underline disabled:opacity-40"
          >
            + Add branch
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Strips empty branch rows before API save.
 * @param {{ label: string, eventType: string, description: string }[]} branches
 */
export function sanitizeOutcomeBranchesForSave(branches) {
  return (branches || [])
    .map((b) => ({
      label: String(b.label || "").trim(),
      eventType: String(b.eventType || "").trim(),
      description: String(b.description || "").trim(),
    }))
    .filter((b) => b.eventType);
}
