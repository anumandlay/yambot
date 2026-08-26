/**
 * @fileoverview Agent work queue panel for chat pages.
 * Purpose: Show pending goals (FIFO) for the bound agent across all chats; edit or remove pending items.
 * Common chat: group pending/active tasks by dispatched agent.
 * Downstream: `GET /api/chats/:id` (`agentQueue`), `PATCH`/`DELETE` `/api/chats/:id/tasks/:taskId`.
 */

import { useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { SectionTitle } from "./FieldLabel.jsx";

/**
 * @typedef {{ _id: string, goal: string, status: string, createdAt?: string, chat?: { _id?: string, title?: string }, agent?: { _id?: string, name?: string } }} QueueTask
 * @typedef {{ agent?: { _id?: string, name?: string }|null, pending?: QueueTask[], active?: QueueTask|null }} AgentQueueGroup
 * @typedef {{ pending?: QueueTask[], active?: QueueTask|null, actives?: QueueTask[], groups?: AgentQueueGroup[] }} AgentQueue
 */

/**
 * @param {{ chatId: string, agentQueue: AgentQueue|null|undefined, isCommon?: boolean, onChanged: () => void|Promise<void>, onError: (err: unknown) => void }} props
 */
export function AgentTaskQueue({ chatId, agentQueue, isCommon = false, onChanged, onError }) {
  const pending = agentQueue?.pending || [];
  const active = agentQueue?.active || null;
  const groups = agentQueue?.groups || [];
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [busyId, setBusyId] = useState(null);

  const hasWork = useMemo(() => {
    if (isCommon && groups.length) {
      return groups.some((g) => g.pending?.length || g.active);
    }
    return Boolean(pending.length || active);
  }, [active, groups, isCommon, pending.length]);

  if (!hasWork) {
    return null;
  }

  /**
   * @param {QueueTask} task
   */
  function startEdit(task) {
    setEditingId(task._id);
    setEditText(task.goal || "");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditText("");
  }

  /**
   * @param {string} taskId
   */
  async function saveEdit(taskId) {
    const goal = editText.trim();
    if (!goal) return;
    setBusyId(taskId);
    try {
      await api(`/api/chats/${chatId}/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ goal }),
      });
      cancelEdit();
      await onChanged();
    } catch (err) {
      onError(err);
    } finally {
      setBusyId(null);
    }
  }

  /**
   * @param {QueueTask} task
   */
  async function removeTask(task) {
    if (!window.confirm("Remove this goal from the agent queue?")) return;
    setBusyId(task._id);
    try {
      await api(`/api/chats/${chatId}/tasks/${task._id}`, { method: "DELETE" });
      if (editingId === task._id) cancelEdit();
      await onChanged();
    } catch (err) {
      onError(err);
    } finally {
      setBusyId(null);
    }
  }

  /**
   * @param {QueueTask} task
   */
  function taskMetaLabel(task) {
    if (isCommon) {
      return task.agent?.name ? `Agent: ${task.agent.name}` : "Agent pending";
    }
    const title = task.chat?.title;
    return title ? `From: ${title}` : "From: another chat";
  }

  /**
   * @param {QueueTask} task
   * @param {number} index
   */
  function renderPendingTask(task, index) {
    const isEditing = editingId === task._id;
    const isBusy = busyId === task._id;
    return (
      <li
        key={task._id}
        className="rounded-xl border border-teal-100 bg-teal-50/40 px-3 py-2 text-sm"
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase text-teal-800/70">
            #{index + 1} · pending
          </span>
          {!isCommon ? (
            <span className="truncate text-xs text-teal-900/60">{taskMetaLabel(task)}</span>
          ) : null}
        </div>

        {isEditing ? (
          <div className="flex flex-col gap-2">
            <textarea
              className="min-h-16 w-full rounded-xl border border-teal-200 bg-white px-3 py-2 text-base"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              disabled={isBusy}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => saveEdit(task._id)}
                disabled={isBusy || !editText.trim()}
                className="inline-flex min-h-11 items-center rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isBusy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                disabled={isBusy}
                className="inline-flex min-h-11 items-center rounded-xl border border-teal-200 bg-white px-4 text-sm font-semibold text-teal-900 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="line-clamp-4 whitespace-pre-wrap break-words text-teal-950">{task.goal}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => startEdit(task)}
                disabled={Boolean(busyId)}
                className="inline-flex min-h-11 items-center rounded-xl border border-teal-200 bg-white px-3 text-sm font-semibold text-teal-900 disabled:opacity-50"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => removeTask(task)}
                disabled={Boolean(busyId)}
                className="inline-flex min-h-11 items-center rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 disabled:opacity-50"
              >
                {isBusy ? "Removing…" : "Delete"}
              </button>
            </div>
          </>
        )}
      </li>
    );
  }

  /**
   * @param {QueueTask} task
   */
  function renderActiveTask(task) {
    return (
      <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
        <div className="mb-1 text-[0.7rem] font-bold uppercase tracking-wide text-sky-800">
          Now: {task.status === "waiting_user" ? "waiting for you" : "running"}
        </div>
        <p className="line-clamp-3 whitespace-pre-wrap break-words">{task.goal}</p>
        {!isCommon ? <p className="mt-1 text-xs text-sky-800/80">{taskMetaLabel(task)}</p> : null}
      </div>
    );
  }

  /**
   * @param {AgentQueueGroup} group
   */
  function renderCommonGroup(group) {
    const agentName = group.agent?.name || "Unknown agent";
    const groupPending = group.pending || [];
    const groupActive = group.active || null;
    if (!groupPending.length && !groupActive) return null;

    return (
      <div key={String(group.agent?._id || agentName)} className="flex flex-col gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-violet-900/80">{agentName}</h3>
        {groupActive ? renderActiveTask(groupActive) : null}
        {groupPending.length ? (
          <ol className="flex max-h-40 flex-col gap-2 overflow-y-auto">
            {groupPending.map((task, index) => renderPendingTask(task, index))}
          </ol>
        ) : null}
      </div>
    );
  }

  return (
    <section
      className="flex shrink-0 flex-col gap-2 rounded-2xl border border-teal-100 bg-white p-3 shadow-sm"
      aria-label={isCommon ? "Chat work queue" : "Agent work queue"}
    >
      <div className="flex items-center justify-between gap-2">
        <SectionTitle helpId="chat.taskQueue">
          {isCommon ? "Queues by agent" : "Agent queue"}
        </SectionTitle>
        {pending.length ? (
          <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800">
            {pending.length} pending
          </span>
        ) : null}
      </div>

      {isCommon && groups.length ? (
        <div className="flex max-h-64 flex-col gap-3 overflow-y-auto">
          {groups.map((group) => renderCommonGroup(group))}
        </div>
      ) : (
        <>
          {active ? renderActiveTask(active) : null}
          {pending.length ? (
            <ol className="flex max-h-48 flex-col gap-2 overflow-y-auto">
              {pending.map((task, index) => renderPendingTask(task, index))}
            </ol>
          ) : (
            <p className="text-xs text-teal-900/60">No pending goals — send one below.</p>
          )}
        </>
      )}
    </section>
  );
}
