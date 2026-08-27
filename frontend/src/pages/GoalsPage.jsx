/**
 * @fileoverview Goals list — durable objectives with groups and copy.
 * Purpose: Create, run, group, copy, and track agent goals with KPIs and priority.
 * Downstream: Goal autonomy next-run countdown uses lastCheckAt + checkIntervalMinutes.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { buildGroupedSections, filterByGroup } from "../lib/groupedList.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { ButtonWithHelp, FieldLabel, PageGuideBanner } from "../components/FieldLabel.jsx";
import { GroupAssignSelect, GroupFilterBar } from "../components/GroupFilterBar.jsx";

/**
 * Epoch ms when autonomy may next spawn a run, or null if timer does not apply.
 * Why: mirrors tickGoalAutonomy — interval from lastCheckAt (0 = due immediately).
 * @param {object} goal
 * @returns {number|null}
 */
function nextAutonomyAtMs(goal) {
  if (!goal?.autonomy?.enabled) return null;
  if (goal.status !== "active") return null;
  const intervalMin = Math.max(1, Number(goal.autonomy.checkIntervalMinutes) || 60);
  const last = goal.autonomy.lastCheckAt ? new Date(goal.autonomy.lastCheckAt).getTime() : 0;
  if (!Number.isFinite(last)) return Date.now();
  return last + intervalMin * 60_000;
}

/**
 * @param {number} remainingMs
 * @returns {string}
 */
function formatCountdown(remainingMs) {
  if (remainingMs <= 0) return "Due now";
  const totalSec = Math.ceil(remainingMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${String(s).padStart(2, "0")}s`;
  if (m > 0) return `${m}:${String(s).padStart(2, "0")}`;
  return `${s}s`;
}

/**
 * @param {object} props
 */
function GoalRow({
  goal,
  groups,
  agentLabel,
  busyId,
  deletingId,
  copyingId,
  nowMs,
  onRun,
  onDelete,
  onCopy,
  onAssignGroup,
}) {
  const nextAt = nextAutonomyAtMs(goal);
  const nextLabel =
    nextAt == null
      ? null
      : nextAt <= nowMs
        ? "Due now"
        : `Next run in ${formatCountdown(nextAt - nowMs)}`;

  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-teal-100 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-4">
      <div className="min-w-0">
        <div className="truncate font-semibold">{goal.title}</div>
        <div className="mt-1 flex flex-wrap gap-2 text-xs text-teal-800/60">
          <span className="rounded bg-teal-50 px-1.5 py-0.5 uppercase">{goal.status}</span>
          <span className="rounded bg-amber-50 px-1.5 py-0.5 uppercase text-amber-900">
            {goal.priority}
          </span>
          <span>Agent: {agentLabel}</span>
          <span>
            Runs: {goal.stats?.runs || 0} ({goal.stats?.successes || 0} ok)
          </span>
          {nextLabel ? (
            <span
              className={`rounded px-1.5 py-0.5 font-semibold tabular-nums ${
                nextAt <= nowMs
                  ? "bg-emerald-50 text-emerald-900"
                  : "bg-sky-50 text-sky-900"
              }`}
              title="Time until the next autonomy check may enqueue a run"
            >
              {nextLabel}
            </span>
          ) : goal.autonomy?.enabled && goal.status !== "active" ? (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
              Autonomy paused
            </span>
          ) : null}
        </div>
        {goal.description ? (
          <p className="mt-1 line-clamp-2 text-sm text-teal-900/70">{goal.description}</p>
        ) : null}
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[14rem]">
        <label className="flex flex-col gap-1 text-xs">
          <FieldLabel helpId="goals.groupAssign" className="text-xs">
            Group
          </FieldLabel>
          <GroupAssignSelect
            entityType="goal"
            groups={groups}
            value={goal.group ? String(goal.group) : ""}
            disabled={Boolean(deletingId) || Boolean(copyingId) || Boolean(busyId)}
            onChange={(gid) => onAssignGroup(goal._id, gid)}
          />
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <ButtonWithHelp helpId="goals.page">
            <Link
              to={`/goals/${goal._id}`}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-teal-100 px-3 text-sm font-semibold"
            >
              Edit
            </Link>
          </ButtonWithHelp>
          <ButtonWithHelp helpId="goals.copy">
            <button
              type="button"
              disabled={Boolean(copyingId) || Boolean(deletingId) || Boolean(busyId)}
              onClick={() => onCopy(goal)}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-violet-100 bg-violet-50 px-3 text-sm font-semibold text-violet-900 disabled:opacity-50"
            >
              {copyingId === goal._id ? "Copying…" : "Copy"}
            </button>
          </ButtonWithHelp>
          <ButtonWithHelp helpId="goals.run">
            <button
              type="button"
              disabled={Boolean(busyId) || !goal.agent || goal.status === "archived" || Boolean(copyingId)}
              onClick={() => onRun(goal._id)}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-teal-700 px-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busyId === goal._id ? "Running…" : "Run now"}
            </button>
          </ButtonWithHelp>
          <ButtonWithHelp helpId="goals.delete">
            <button
              type="button"
              disabled={Boolean(deletingId) || Boolean(busyId) || Boolean(copyingId)}
              onClick={() => onDelete(goal)}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 disabled:opacity-50"
            >
              {deletingId === goal._id ? "Deleting…" : "Delete"}
            </button>
          </ButtonWithHelp>
        </div>
      </div>
    </li>
  );
}

export function GoalsPage() {
  const [goals, setGoals] = useState([]);
  const [agents, setAgents] = useState([]);
  const [groups, setGroups] = useState([]);
  const [filterGroupId, setFilterGroupId] = useState("");
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [copyingId, setCopyingId] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const navigate = useNavigate();

  async function loadGroups() {
    const data = await api("/api/groups?type=goal");
    setGroups(data.groups || []);
  }

  async function load() {
    try {
      const [goalData, agentData] = await Promise.all([
        api("/api/goals"),
        api("/api/agents"),
        loadGroups(),
      ]);
      setGoals(goalData.goals || []);
      setAgents(agentData.agents || []);
    } catch (err) {
      setError(err);
    }
  }

  useEffect(() => {
    load();
  }, []);

  /** Why: live countdown for autonomy next-run badges. */
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  /** Why: pick up lastCheckAt after the scheduler ticks without forcing a full page reload. */
  const hasAutonomyTimer = useMemo(
    () => goals.some((g) => g.autonomy?.enabled && g.status === "active"),
    [goals]
  );

  useEffect(() => {
    if (!hasAutonomyTimer) return undefined;
    const id = window.setInterval(() => {
      load().catch(() => {});
    }, 30_000);
    return () => window.clearInterval(id);
  }, [hasAutonomyTimer]);

  const agentNameById = useMemo(() => {
    const map = new Map();
    for (const a of agents) map.set(String(a._id), a.name || a._id);
    return map;
  }, [agents]);

  const visibleGoals = useMemo(
    () => filterByGroup(goals, filterGroupId, (g) => (g.group ? String(g.group) : "")),
    [goals, filterGroupId]
  );

  const grouped = useMemo(
    () => buildGroupedSections(visibleGoals, groups, (g) => (g.group ? String(g.group) : "")),
    [visibleGoals, groups]
  );

  /**
   * @param {string} goalId
   */
  async function runGoal(goalId) {
    setBusyId(goalId);
    setError(null);
    try {
      const data = await api(`/api/goals/${goalId}/run`, { method: "POST", body: JSON.stringify({}) });
      if (data.chatId) navigate(`/chats/${data.chatId}`);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusyId("");
    }
  }

  /**
   * @param {object} goal
   */
  async function deleteGoal(goal) {
    const label = goal.title || "this goal";
    if (!window.confirm(`Delete goal “${label}”? Past run stats are removed; chat history from runs is kept.`)) {
      return;
    }
    setDeletingId(goal._id);
    setError(null);
    try {
      await api(`/api/goals/${goal._id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setDeletingId("");
    }
  }

  /**
   * @param {object} goal
   */
  async function copyGoal(goal) {
    setCopyingId(goal._id);
    setError(null);
    try {
      const data = await api(`/api/goals/${goal._id}/copy`, { method: "POST" });
      await load();
      if (data.goal?._id) navigate(`/goals/${data.goal._id}`);
    } catch (err) {
      setError(err);
    } finally {
      setCopyingId("");
    }
  }

  /**
   * @param {string} goalId
   * @param {string} groupId
   */
  async function assignGoalGroup(goalId, groupId) {
    setError(null);
    try {
      await api(`/api/goals/${goalId}`, {
        method: "PUT",
        body: JSON.stringify({ group: groupId || null }),
      });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  const rowProps = {
    groups,
    busyId,
    deletingId,
    copyingId,
    nowMs,
    onRun: runGoal,
    onDelete: deleteGoal,
    onCopy: copyGoal,
    onAssignGroup: assignGoalGroup,
    agentLabel: "",
  };

  const showGrouped = !filterGroupId;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6 lg:max-w-4xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Goals</h1>
          <p className="text-sm text-teal-900/70">
            Durable objectives with success criteria and KPIs — run on an agent&apos;s cloud computer.
            Autonomy goals show a live countdown to the next scheduled check.
          </p>
        </div>
        <ButtonWithHelp helpId="goals.new">
          <Link
            to="/goals/new"
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-teal-700 px-4 font-semibold text-white sm:w-auto"
          >
            New goal
          </Link>
        </ButtonWithHelp>
      </div>

      <PageGuideBanner helpId="goals.page" />

      <GroupFilterBar
        entityType="goal"
        groups={groups}
        filterGroupId={filterGroupId}
        onFilterChange={setFilterGroupId}
        onGroupsChange={loadGroups}
      />

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}

      {goals.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-teal-200 bg-white/70 p-6 text-sm text-teal-900/70">
          No goals yet. Create one and assign an agent to run it.
        </div>
      ) : visibleGoals.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-teal-200 bg-white/70 p-6 text-sm text-teal-900/70">
          No goals in this group.
        </div>
      ) : showGrouped ? (
        <div className="flex flex-col gap-4">
          {grouped.sections
            .filter((s) => s.items.length > 0)
            .map((section) => (
              <section key={section.group._id} className="flex flex-col gap-2">
                <h2 className="text-sm font-bold uppercase tracking-wide text-teal-800/70">
                  {section.group.name}
                  <span className="ml-2 font-normal normal-case text-teal-900/50">
                    ({section.items.length})
                  </span>
                </h2>
                <ul className="flex flex-col gap-2">
                  {section.items.map((g) => (
                    <GoalRow
                      key={g._id}
                      goal={g}
                      agentLabel={agentNameById.get(String(g.agent)) || "—"}
                      {...rowProps}
                    />
                  ))}
                </ul>
              </section>
            ))}
          {grouped.ungrouped.length ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-bold uppercase tracking-wide text-teal-800/70">
                Ungrouped
                <span className="ml-2 font-normal normal-case text-teal-900/50">
                  ({grouped.ungrouped.length})
                </span>
              </h2>
              <ul className="flex flex-col gap-2">
                {grouped.ungrouped.map((g) => (
                  <GoalRow
                    key={g._id}
                    goal={g}
                    agentLabel={agentNameById.get(String(g.agent)) || "—"}
                    {...rowProps}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {visibleGoals.map((g) => (
            <GoalRow
              key={g._id}
              goal={g}
              agentLabel={agentNameById.get(String(g.agent)) || "—"}
              {...rowProps}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
