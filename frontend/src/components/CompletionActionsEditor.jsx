/**
 * @fileoverview Completion actions editor — parallel follow-ups after goal/trigger runs.
 * Purpose: Configure rule/LLM-picked instructions or goal delegations on success/failure.
 * Downstream: GoalEditPage, OperationsPage.
 */

import { FieldLabel } from "./FieldLabel.jsx";

const EMPTY_ACTION = {
  label: "",
  runOn: "success",
  when: "",
  kind: "instruction",
  agentId: "",
  goalId: "",
  instructions: "",
};

/**
 * @param {{
 *   enabled: boolean,
 *   onEnabledChange: (v: boolean) => void,
 *   pickMode: 'rules'|'llm',
 *   onPickModeChange: (v: 'rules'|'llm') => void,
 *   actions: object[],
 *   onActionsChange: (actions: object[]) => void,
 *   agents?: { _id: string, name?: string }[],
 *   goals?: { _id: string, title?: string }[],
 *   helpIdEnabled?: string,
 *   helpIdAction?: string,
 *   className?: string,
 * }} props
 */
export function CompletionActionsEditor({
  enabled,
  onEnabledChange,
  pickMode,
  onPickModeChange,
  actions,
  onActionsChange,
  agents = [],
  goals = [],
  helpIdEnabled = "goal.completionActions",
  helpIdAction = "goal.completionAction",
  className = "",
}) {
  const rows = actions.length ? actions : [{ ...EMPTY_ACTION }];

  /**
   * @param {number} index
   * @param {string} field
   * @param {string} value
   */
  function updateRow(index, field, value) {
    const next = rows.map((row, i) => (i === index ? { ...row, [field]: value } : row));
    onActionsChange(next);
  }

  function addRow() {
    if (rows.length >= 12) return;
    onActionsChange([...rows, { ...EMPTY_ACTION }]);
  }

  /**
   * @param {number} index
   */
  function removeRow(index) {
    const next = rows.filter((_, i) => i !== index);
    onActionsChange(next.length ? next : [{ ...EMPTY_ACTION }]);
  }

  return (
    <div
      className={`flex flex-col gap-2 rounded-xl border border-emerald-100 bg-emerald-50/30 p-3 ${className}`}
    >
      <label className="flex items-center gap-2 text-sm font-medium text-teal-950">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className="h-4 w-4 rounded border-emerald-200"
        />
        <FieldLabel helpId={helpIdEnabled}>Completion actions (parallel follow-ups)</FieldLabel>
      </label>
      <p className="text-xs text-teal-900/60">
        After the run finishes (success or failure), YamBot can spawn multiple follow-up tasks in
        parallel — free-text instructions or another goal. Parent result is injected via{" "}
        <code className="font-mono">{"{{result}}"}</code>.
      </p>
      {enabled ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-teal-950">How to pick actions</span>
            <select
              className="min-h-9 rounded-lg border border-teal-100 px-2 text-sm"
              value={pickMode}
              onChange={(e) => onPickModeChange(e.target.value === "llm" ? "llm" : "rules")}
            >
              <option value="rules">Rules — match keywords or /regex/ on result</option>
              <option value="llm">LLM — read result and pick which actions run</option>
            </select>
          </label>
          {rows.map((row, index) => (
            <div
              key={`completion-action-${index}`}
              className="grid grid-cols-1 gap-2 rounded-lg border border-emerald-100 bg-white p-2 sm:grid-cols-2"
            >
              <label className="flex flex-col gap-1 text-xs">
                <FieldLabel helpId={helpIdAction} className="text-xs">
                  Label
                </FieldLabel>
                <input
                  className="min-h-9 rounded-lg border border-teal-100 px-2 text-sm"
                  value={row.label}
                  onChange={(e) => updateRow(index, "label", e.target.value)}
                  placeholder="Logout CRM"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-teal-950">Run on</span>
                <select
                  className="min-h-9 rounded-lg border border-teal-100 px-2 text-sm"
                  value={row.runOn || "success"}
                  onChange={(e) => updateRow(index, "runOn", e.target.value)}
                >
                  <option value="success">Success only</option>
                  <option value="failure">Failure only</option>
                  <option value="both">Success or failure</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs sm:col-span-2">
                <span className="font-medium text-teal-950">
                  When {pickMode === "llm" ? "(hint for LLM)" : "(rules)"}
                </span>
                <input
                  className="min-h-9 rounded-lg border border-teal-100 px-2 text-sm"
                  value={row.when}
                  onChange={(e) => updateRow(index, "when", e.target.value)}
                  placeholder="empty = always | keyword | /pattern/i"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-teal-950">Action type</span>
                <select
                  className="min-h-9 rounded-lg border border-teal-100 px-2 text-sm"
                  value={row.kind || "instruction"}
                  onChange={(e) => updateRow(index, "kind", e.target.value)}
                >
                  <option value="instruction">Free-text instructions</option>
                  <option value="goal">Run another goal</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-teal-950">Agent (optional)</span>
                <select
                  className="min-h-9 rounded-lg border border-teal-100 px-2 text-sm"
                  value={row.agentId || ""}
                  onChange={(e) => updateRow(index, "agentId", e.target.value)}
                >
                  <option value="">Default (goal agent or parent)</option>
                  {agents.map((a) => (
                    <option key={a._id} value={a._id}>
                      {a.name || a._id}
                    </option>
                  ))}
                </select>
              </label>
              {row.kind === "goal" ? (
                <label className="flex flex-col gap-1 text-xs sm:col-span-2">
                  <span className="font-medium text-teal-950">Goal to run</span>
                  <select
                    className="min-h-9 rounded-lg border border-teal-100 px-2 text-sm"
                    value={row.goalId || ""}
                    onChange={(e) => updateRow(index, "goalId", e.target.value)}
                  >
                    <option value="">— pick goal —</option>
                    {goals.map((g) => (
                      <option key={g._id} value={g._id}>
                        {g.title || g._id}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="flex flex-col gap-1 text-xs sm:col-span-2">
                  <span className="font-medium text-teal-950">Instructions</span>
                  <textarea
                    className="min-h-16 rounded-lg border border-teal-100 px-2 py-1 text-sm"
                    value={row.instructions}
                    onChange={(e) => updateRow(index, "instructions", e.target.value)}
                    placeholder="Summarize {{result}} and email the team."
                  />
                </label>
              )}
              {rows.length > 1 ? (
                <div className="sm:col-span-2">
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    className="text-xs font-semibold text-red-700 underline"
                  >
                    Remove action
                  </button>
                </div>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            onClick={addRow}
            disabled={rows.length >= 12}
            className="self-start text-xs font-semibold text-emerald-800 underline disabled:opacity-40"
          >
            + Add action
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Strips empty rows before API save.
 * @param {object[]} actions
 */
export function sanitizeCompletionActionsForSave(actions) {
  return (actions || [])
    .map((a) => ({
      label: String(a.label || "").trim(),
      runOn: ["success", "failure", "both"].includes(a.runOn) ? a.runOn : "success",
      when: String(a.when || "").trim(),
      kind: a.kind === "goal" ? "goal" : "instruction",
      agentId: String(a.agentId || "").trim(),
      goalId: String(a.goalId || "").trim(),
      instructions: String(a.instructions || "").trim(),
    }))
    .filter((a) => {
      if (!a.label) return false;
      if (a.kind === "goal") return Boolean(a.goalId);
      return Boolean(a.instructions);
    });
}
