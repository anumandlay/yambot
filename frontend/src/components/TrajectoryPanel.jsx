/**
 * @fileoverview Task trajectory replay — compact step chain from Phase 5 learn layer.
 * Purpose: Debug agent runs in chat rail; save successful trajectories as skill demos.
 * Downstream: ChatDetailPage; Task.trajectory + `/api/skills/demos/from-task/:id`.
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { ButtonWithHelp, SectionTitle } from "./FieldLabel.jsx";

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
 * @param {{ task?: object|null, className?: string }} props
 */
export function TrajectoryPanel({ task, className = "" }) {
  const navigate = useNavigate();
  const rows = useMemo(() => trajectoryRowsFromTask(task), [task]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  if (!rows.length) return null;

  const failed = rows.filter((r) => !r.ok).length;
  const canSaveDemo =
    task?._id && ["done", "error"].includes(String(task.status || ""));

  async function saveAsDemo() {
    if (!task?._id || busy) return;
    setBusy(true);
    setMsg("");
    try {
      const data = await api(`/api/skills/demos/from-task/${task._id}`, {
        method: "POST",
        body: JSON.stringify({ title: (task.goal || "Task trajectory").slice(0, 120) }),
      });
      setMsg("Demo saved — open Skills to convert.");
      navigate("/skills");
      return data;
    } catch (err) {
      setMsg(err.detail || err.message || "Could not save demo");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details
      className={`rounded-2xl border border-teal-100 bg-white shadow-sm ${className}`}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer list-none px-3 py-2 [&::-webkit-details-marker]:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <SectionTitle as="span" helpId="chat.trajectory" className="inline-flex">
              Trajectory
            </SectionTitle>
            <span className="ml-2 rounded-lg bg-teal-50 px-2 py-0.5 font-mono text-xs text-teal-800">
              {rows.length} steps
              {failed ? ` · ${failed} failed` : ""}
            </span>
          </div>
          {canSaveDemo ? (
            <ButtonWithHelp helpId="chat.trajectorySave">
              <button
                type="button"
                disabled={busy}
                onClick={(e) => {
                  e.preventDefault();
                  saveAsDemo();
                }}
                className="min-h-8 rounded-lg border border-teal-200 bg-teal-50 px-2 text-xs font-semibold text-teal-800 disabled:opacity-50"
              >
                {busy ? "Saving…" : "→ Demo"}
              </button>
            </ButtonWithHelp>
          ) : null}
        </div>
        {msg ? <p className="mt-1 text-xs text-teal-800">{msg}</p> : null}
      </summary>
      <div className="max-h-40 overflow-auto border-t border-teal-50 p-2">
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
    </details>
  );
}
