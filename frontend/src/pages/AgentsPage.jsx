/**
 * @fileoverview Agents list — create, group, copy, open, and delete browser agents.
 * Purpose: Entry point for managing agent profiles with folder-style EntityGroups.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { buildGroupedSections, filterByGroup } from "../lib/groupedList.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { ButtonWithHelp, FieldLabel, PageGuideBanner } from "../components/FieldLabel.jsx";
import { GroupAssignSelect, GroupFilterBar } from "../components/GroupFilterBar.jsx";
import { GettingStartedCard } from "../components/GettingStartedCard.jsx";
import { useSetupStatus } from "../hooks/useSetupStatus.js";

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
      <div className="min-w-0">
        <div className="truncate font-semibold">{agent.name}</div>
        <div className="flex flex-wrap gap-2 text-xs uppercase tracking-wide text-teal-800/60">
          {agent.skill ? <span className="normal-case">{agent.skill}</span> : null}
          {agent.skill ? <span>·</span> : null}
          <span>cloud computer</span>
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
          <span className={agent.computer?.online ? "text-emerald-700" : ""}>
            {agent.computer?.online ? "online" : "offline"}
          </span>
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
    () => filterByGroup(agents, filterGroupId, (a) => (a.group ? String(a.group) : "")),
    [agents, filterGroupId]
  );

  const grouped = useMemo(
    () => buildGroupedSections(visibleAgents, groups, (a) => (a.group ? String(a.group) : "")),
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
   * @param {object} agent
   */
  async function deleteAgent(agent) {
    const label = agent.name || agent._id;
    if (
      !window.confirm(
        `Delete agent “${label}”? Its cloud computer container will be stopped and removed.`
      )
    ) {
      return;
    }
    setDeletingId(agent._id);
    setError(null);
    try {
      await api(`/api/agents/${agent._id}`, { method: "DELETE" });
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
    onDelete: deleteAgent,
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
                  {section.items.map((a) => (
                    <AgentRow key={a._id} agent={a} {...rowProps} />
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
                {grouped.ungrouped.map((a) => (
                  <AgentRow key={a._id} agent={a} {...rowProps} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {visibleAgents.map((a) => (
            <AgentRow key={a._id} agent={a} {...rowProps} />
          ))}
        </ul>
      )}
    </div>
  );
}
