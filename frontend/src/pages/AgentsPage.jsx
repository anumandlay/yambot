/**
 * @fileoverview Agents list — create, group, copy, open, and delete browser agents.
 * Purpose: Entry point for managing agent profiles with folder-style EntityGroups.
 * Downstream: DELETE /api/agents/:id requires account password; soft-delete lands on History.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { buildGroupedSections, entityGroupId, filterByGroup } from "../lib/groupedList.js";
import { AgentGroupFolder } from "../components/AgentGroupFolder.jsx";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { ButtonWithHelp, FieldLabel, PageGuideBanner } from "../components/FieldLabel.jsx";
import { GroupAssignSelect, GroupFilterBar } from "../components/GroupFilterBar.jsx";
import { GettingStartedCard } from "../components/GettingStartedCard.jsx";
import { useSetupStatus } from "../hooks/useSetupStatus.js";
import { AgentAvatar } from "../components/AgentAvatar.jsx";

/**
 * Password confirmation dialog before soft-deleting an agent.
 * @param {object} props
 * @param {object} props.agent
 * @param {boolean} props.busy
 * @param {(password: string) => void} props.onConfirm
 * @param {() => void} props.onCancel
 */
function DeleteAgentModal({ agent, busy, onConfirm, onCancel }) {
  const [password, setPassword] = useState("");
  const label = agent?.name || agent?._id || "agent";

  /**
   * @param {import("react").FormEvent} e
   */
  function onSubmit(e) {
    e.preventDefault();
    if (!password.trim() || busy) return;
    onConfirm(password);
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-teal-950/45 p-0 sm:items-center sm:p-4"
      role="presentation"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-agent-title"
        className="flex w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-teal-100 bg-white shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-teal-100 px-4 py-3">
          <h2 id="delete-agent-title" className="text-sm font-bold text-teal-950">
            Delete agent
          </h2>
          <p className="mt-1 text-sm text-teal-900/70">
            Delete “{label}”? It leaves Agents and moves to History. Chats and memory are kept —
            you can Restore later. Enter your account password to confirm.
          </p>
        </div>
        <form onSubmit={onSubmit} className="flex flex-col gap-3 px-4 py-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold text-teal-950">Account password</span>
            <input
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              className="min-h-11 rounded-xl border border-teal-200 bg-white px-3 text-sm"
              placeholder="Your YamBot login password"
            />
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-teal-200 px-4 text-sm font-semibold disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !password.trim()}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-red-200 bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Deleting…" : "Delete agent"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} props.agent
 * @param {object[]} props.groups
 * @param {boolean} props.busy
 * @param {string} props.deletingId
 * @param {string} props.copyingId
 * @param {(id: string) => void} props.onStartChat
 * @param {(agent: object) => void} props.onDelete
 * @param {(agent: object) => void} props.onCopy
 * @param {(agentId: string, groupId: string) => void} props.onAssignGroup
 */
function AgentRow({
  agent,
  groups,
  busy,
  deletingId,
  copyingId,
  onStartChat,
  onDelete,
  onCopy,
  onAssignGroup,
}) {
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-teal-100 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-4">
      <div className="flex min-w-0 items-start gap-3">
        <AgentAvatar agent={agent} size="md" className="mt-0.5" />
        <div className="min-w-0">
        <div className="truncate font-semibold">{agent.name}</div>
        <div className="flex flex-wrap gap-2 text-xs uppercase tracking-wide text-teal-800/60">
          {agent.skill ? <span className="normal-case">{agent.skill}</span> : null}
          {agent.skill ? <span>·</span> : null}
          {agent.mode === "api" ? (
            <span className="text-sky-800">API only</span>
          ) : (
            <span>cloud computer</span>
          )}
          {agent.schedule?.enabled ? (
            <>
              <span>·</span>
              <span className="text-amber-800">scheduled {agent.schedule.interval}</span>
            </>
          ) : null}
          {agent.email?.configured || agent.email?.enabled ? (
            <>
              <span>·</span>
              <span className="normal-case text-sky-800">{agent.email?.fromAddress || "email"}</span>
            </>
          ) : null}
          <span>·</span>
          {agent.mode === "api" ? (
            <span className="text-sky-800">no live box</span>
          ) : (
            <span className={agent.computer?.online ? "text-emerald-700" : ""}>
              {agent.computer?.online ? "online" : "offline"}
            </span>
          )}
        </div>
        {agent.createdAt ? (
          <p className="mt-1 text-xs text-teal-800/55">
            Created {new Date(agent.createdAt).toLocaleString()}
          </p>
        ) : null}
        {agent.readiness ? (
          <p
            className={`mt-1 text-xs font-semibold ${
              agent.readiness.score >= 80
                ? "text-emerald-800"
                : agent.readiness.score >= 50
                  ? "text-amber-800"
                  : "text-rose-800"
            }`}
          >
            Readiness {agent.readiness.score}%
            {agent.lifecycleStatus && agent.lifecycleStatus !== "active" ? (
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[0.65rem] font-bold uppercase text-slate-700">
                {agent.lifecycleStatus}
              </span>
            ) : null}
          </p>
        ) : agent.lifecycleStatus ? (
          <p className="mt-1 text-xs text-teal-800/70">
            Lifecycle: <span className="font-semibold">{agent.lifecycleStatus}</span>
          </p>
        ) : null}
        {agent.description ? (
          <p className="mt-1 break-words text-sm text-teal-900/70">{agent.description}</p>
        ) : null}
        </div>
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[14rem]">
        <label className="flex flex-col gap-1 text-xs">
          <FieldLabel helpId="agents.groupAssign" className="text-xs">
            Group
          </FieldLabel>
          <GroupAssignSelect
            entityType="agent"
            groups={groups}
            value={agent.group ? String(agent.group) : ""}
            disabled={Boolean(deletingId) || Boolean(copyingId)}
            onChange={(gid) => onAssignGroup(agent._id, gid)}
          />
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <ButtonWithHelp helpId="agents.edit">
            <Link
              to={`/agents/${agent._id}`}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-teal-100 px-3 text-sm font-semibold sm:w-auto"
            >
              Edit
            </Link>
          </ButtonWithHelp>
          <Link
            to={`/agents/${agent._id}/runs`}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-3 text-sm font-semibold text-amber-950 sm:w-auto"
          >
            Runs
          </Link>
          <Link
            to={`/agents/${agent._id}/memory`}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-violet-200 bg-violet-50 px-3 text-sm font-semibold text-violet-950 sm:w-auto"
          >
            View memory
            {Array.isArray(agent.memory) ? ` (${agent.memory.length})` : ""}
          </Link>
          <Link
            to={`/agents/${agent._id}/memory#mem0`}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-3 text-sm font-semibold text-amber-950 sm:w-auto"
          >
            View Mem0
          </Link>
          <ButtonWithHelp helpId="agents.copy">
            <button
              type="button"
              disabled={Boolean(copyingId) || Boolean(deletingId)}
              onClick={() => onCopy(agent)}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-violet-100 bg-violet-50 px-3 text-sm font-semibold text-violet-900 disabled:opacity-50 sm:w-auto"
            >
              {copyingId === agent._id ? "Copying…" : "Copy"}
            </button>
          </ButtonWithHelp>
          <ButtonWithHelp helpId="agents.chat">
            <button
              type="button"
              disabled={busy || agent.active === false || Boolean(copyingId)}
              onClick={() => onStartChat(agent._id)}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-teal-700 px-3 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto"
            >
              Start chat
            </button>
          </ButtonWithHelp>
          <ButtonWithHelp helpId="agents.delete">
            <button
              type="button"
              disabled={Boolean(deletingId) || Boolean(copyingId)}
              onClick={() => onDelete(agent)}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 disabled:opacity-50 sm:w-auto"
            >
              {deletingId === agent._id ? "Deleting…" : "Delete"}
            </button>
          </ButtonWithHelp>
        </div>
      </div>
    </li>
  );
}

export function AgentsPage() {
  const [agents, setAgents] = useState([]);
  const [groups, setGroups] = useState([]);
  const [filterGroupId, setFilterGroupId] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [copyingId, setCopyingId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const navigate = useNavigate();

  async function loadGroups() {
    const data = await api("/api/groups?type=agent");
    setGroups(data.groups || []);
  }

  async function load() {
    try {
      const [agentData] = await Promise.all([api("/api/agents"), loadGroups()]);
      setAgents(agentData.agents || []);
    } catch (err) {
      setError(err);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const visibleAgents = useMemo(
    () => filterByGroup(agents, filterGroupId, (a) => entityGroupId(a) || null),
    [agents, filterGroupId]
  );

  const grouped = useMemo(
    () => buildGroupedSections(visibleAgents, groups, (a) => entityGroupId(a) || null),
    [visibleAgents, groups]
  );

  async function startChat(agentId) {
    setBusy(true);
    setError(null);
    try {
      const data = await api("/api/chats", {
        method: "POST",
        body: JSON.stringify({ agentId }),
      });
      navigate(`/chats/${data.chat._id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Opens the password confirmation dialog for soft-delete.
   * @param {object} agent
   */
  function openDeleteAgent(agent) {
    setError(null);
    setDeleteTarget(agent);
  }

  /**
   * Soft-deletes after the user typed their account password in the modal.
   * @param {string} password
   */
  async function confirmDeleteAgent(password) {
    if (!deleteTarget?._id) return;
    setDeletingId(deleteTarget._id);
    setError(null);
    try {
      await api(`/api/agents/${deleteTarget._id}`, {
        method: "DELETE",
        body: JSON.stringify({ password }),
      });
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setDeletingId("");
    }
  }

  /**
   * @param {object} agent
   */
  async function copyAgent(agent) {
    setCopyingId(agent._id);
    setError(null);
    try {
      const data = await api(`/api/agents/${agent._id}/copy`, { method: "POST" });
      await load();
      if (data.agent?._id) navigate(`/agents/${data.agent._id}`);
    } catch (err) {
      setError(err);
    } finally {
      setCopyingId("");
    }
  }

  /**
   * @param {string} agentId
   * @param {string} groupId
   */
  async function assignAgentGroup(agentId, groupId) {
    setError(null);
    try {
      await api(`/api/agents/${agentId}`, {
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
    busy,
    deletingId,
    copyingId,
    onStartChat: startChat,
    onDelete: openDeleteAgent,
    onCopy: copyAgent,
    onAssignGroup: assignAgentGroup,
  };

  const showGrouped = !filterGroupId;
  const { complete: setupComplete, refresh: refreshSetup } = useSetupStatus();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6 lg:max-w-4xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Agents</h1>
          <p className="text-sm text-teal-900/70">
            Creating an agent provisions its own cloud Chromium box on the VPS. Watch all screens on{" "}
            <Link to="/live" className="font-semibold text-teal-800 underline">
              Live Wall
            </Link>
            , or open a chat / agent page for one computer.
          </p>
        </div>
        <ButtonWithHelp helpId="agents.new">
          <Link
            to="/agents/new"
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-teal-700 px-4 font-semibold text-white sm:w-auto"
          >
            New agent
          </Link>
        </ButtonWithHelp>
      </div>

      <PageGuideBanner helpId="agents.page" />

      {!setupComplete ? <GettingStartedCard compact onAgentCreated={refreshSetup} /> : null}

      <GroupFilterBar
        entityType="agent"
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

      {agents.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-teal-200 bg-white/70 p-6 text-sm text-teal-900/70">
          No agents yet. Use the setup steps above for a quick create, or{" "}
          <Link to="/agents/new" className="font-semibold text-teal-800 underline">
            open the full agent form
          </Link>{" "}
          for advanced options.
        </div>
      ) : visibleAgents.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-teal-200 bg-white/70 p-6 text-sm text-teal-900/70">
          No agents in this group.
        </div>
      ) : showGrouped ? (
        <ul className="flex flex-col gap-3">
          {grouped.sections
            .filter((s) => s.items.length > 0)
            .map((section) => {
              const key = String(section.group._id);
              const open = !collapsed.has(key);
              return (
                <AgentGroupFolder
                  key={key}
                  label={section.group.name || "Group"}
                  count={section.items.length}
                  open={open}
                  onToggle={() => {
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    });
                  }}
                >
                  {section.items.map((a) => (
                    <AgentRow key={a._id} agent={a} {...rowProps} />
                  ))}
                </AgentGroupFolder>
              );
            })}
          {grouped.ungrouped.length ? (
            <AgentGroupFolder
              key="ungrouped"
              label="Ungrouped"
              count={grouped.ungrouped.length}
              open={!collapsed.has("ungrouped")}
              onToggle={() => {
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has("ungrouped")) next.delete("ungrouped");
                  else next.add("ungrouped");
                  return next;
                });
              }}
            >
              {grouped.ungrouped.map((a) => (
                <AgentRow key={a._id} agent={a} {...rowProps} />
              ))}
            </AgentGroupFolder>
          ) : null}
        </ul>
      ) : (
        <ul className="flex flex-col gap-2">
          {visibleAgents.map((a) => (
            <AgentRow key={a._id} agent={a} {...rowProps} />
          ))}
        </ul>
      )}

      {deleteTarget ? (
        <DeleteAgentModal
          agent={deleteTarget}
          busy={Boolean(deletingId)}
          onConfirm={(pw) => void confirmDeleteAgent(pw)}
          onCancel={() => {
            if (!deletingId) setDeleteTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}
