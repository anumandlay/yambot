/**
 * @fileoverview Group filter bar — create groups and filter agent/goal lists.
 * Purpose: User-defined folders (e.g. CRM team) with filter + safe group deletion.
 * Downstream: AgentsPage, GoalsPage.
 */

import { useState } from "react";
import { api } from "../lib/api.js";
import { FieldLabel } from "./FieldLabel.jsx";

/**
 * @param {{
 *   entityType: 'agent'|'goal',
 *   groups: object[],
 *   filterGroupId: string,
 *   onFilterChange: (id: string) => void,
 *   onGroupsChange: () => void,
 * }} props
 */
export function GroupFilterBar({
  entityType,
  groups,
  filterGroupId,
  onFilterChange,
  onGroupsChange,
}) {
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [manageOpen, setManageOpen] = useState(false);
  /** @type {string|null} */
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const pendingGroup = groups.find((g) => String(g._id) === String(pendingDeleteId));

  async function createGroup(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/groups", {
        method: "POST",
        body: JSON.stringify({ type: entityType, name }),
      });
      setNewName("");
      await onGroupsChange();
    } catch (err) {
      setError(err.detail || err.message || "Could not create group");
    } finally {
      setBusy(false);
    }
  }

  function startDelete(groupId) {
    setPendingDeleteId(String(groupId));
    setDeleteConfirmText("");
    setError("");
  }

  function cancelDelete() {
    setPendingDeleteId(null);
    setDeleteConfirmText("");
  }

  async function confirmDelete() {
    if (!pendingGroup) return;
    if (deleteConfirmText.trim() !== pendingGroup.name) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/groups/${pendingGroup._id}`, { method: "DELETE" });
      if (filterGroupId === String(pendingGroup._id)) onFilterChange("");
      cancelDelete();
      await onGroupsChange();
    } catch (err) {
      setError(err.detail || err.message || "Could not delete group");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-teal-100 bg-white p-3 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <FieldLabel helpId={`${entityType}s.groupFilter`}>Filter by group</FieldLabel>
          <select
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={filterGroupId}
            onChange={(e) => onFilterChange(e.target.value)}
          >
            <option value="">All groups</option>
            <option value="ungrouped">Ungrouped only</option>
            {groups.map((g) => (
              <option key={g._id} value={g._id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <form onSubmit={createGroup} className="flex flex-1 flex-col gap-1 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <FieldLabel helpId={`${entityType}s.newGroup`}>New group</FieldLabel>
            <input
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={entityType === "agent" ? "CRM team" : "Vughy workflows"}
            />
          </label>
          <button
            type="submit"
            disabled={busy || !newName.trim()}
            className="min-h-11 rounded-xl border border-teal-200 bg-teal-50 px-4 text-sm font-semibold text-teal-900 disabled:opacity-50"
          >
            Add group
          </button>
        </form>
      </div>

      {groups.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-2 text-xs">
            {groups.map((g) => (
              <span
                key={g._id}
                className="rounded-full bg-teal-50 px-2.5 py-1 font-medium text-teal-900"
              >
                {g.name}
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setManageOpen((v) => !v);
              cancelDelete();
            }}
            className="text-xs font-semibold text-teal-800 underline"
          >
            {manageOpen ? "Hide manage groups" : "Manage groups…"}
          </button>
        </div>
      ) : null}

      {manageOpen && groups.length ? (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-100 bg-amber-50/40 p-3">
          <p className="text-xs text-teal-900/70">
            Deleting a group only removes the folder — {entityType === "agent" ? "agents" : "goals"}{" "}
            move to Ungrouped. Type the group name to confirm.
          </p>
          <ul className="flex flex-col gap-2">
            {groups.map((g) => {
              const isPending = pendingDeleteId === String(g._id);
              return (
                <li
                  key={g._id}
                  className="flex flex-col gap-2 rounded-lg border border-teal-100 bg-white p-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="text-sm font-medium text-teal-950">{g.name}</span>
                  {isPending ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        className="min-h-9 flex-1 rounded-lg border border-red-200 px-2 text-sm"
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        placeholder={`Type “${g.name}” to confirm`}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={cancelDelete}
                          disabled={busy}
                          className="min-h-9 rounded-lg border border-teal-200 px-3 text-xs font-semibold"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={confirmDelete}
                          disabled={busy || deleteConfirmText.trim() !== g.name}
                          className="min-h-9 rounded-lg border border-red-300 bg-red-50 px-3 text-xs font-semibold text-red-800 disabled:opacity-40"
                        >
                          Delete group
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={busy || Boolean(pendingDeleteId)}
                      onClick={() => startDelete(g._id)}
                      className="self-start text-xs font-semibold text-red-700 underline disabled:opacity-40"
                    >
                      Delete…
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}

/**
 * @param {{
 *   entityType: 'agent'|'goal',
 *   groups: object[],
 *   value: string,
 *   onChange: (groupId: string) => void,
 *   disabled?: boolean,
 *   className?: string,
 * }} props
 */
export function GroupAssignSelect({
  entityType,
  groups,
  value,
  onChange,
  disabled = false,
  className = "",
}) {
  return (
    <select
      className={`min-h-9 rounded-lg border border-teal-100 px-2 text-xs ${className}`}
      value={value || ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      title={`Move ${entityType} to group`}
    >
      <option value="">No group</option>
      {groups.map((g) => (
        <option key={g._id} value={g._id}>
          {g.name}
        </option>
      ))}
    </select>
  );
}
