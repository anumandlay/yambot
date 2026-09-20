/**
 * @fileoverview History — current + archived agents with links to chats, episodic memory, and curated MEMORY.
 * Purpose: Soft-deleted agents stay visible here so past chats/tasks/memory remain reachable.
 * Downstream: GET /api/agents/history, POST /api/agents/:id/restore, AgentChatHistoryPage, AgentMemoryPage.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { PageGuideBanner } from "../components/FieldLabel.jsx";
import { AgentAvatar } from "../components/AgentAvatar.jsx";

/**
 * @param {object} props
 * @param {object} props.agent
 * @param {boolean} props.archived
 * @param {boolean} props.busy
 * @param {() => void} [props.onRestore]
 */
function HistoryRow({ agent, archived, busy, onRestore }) {
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-teal-100 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-4">
      <div className="flex min-w-0 items-start gap-3">
        <AgentAvatar
          agent={{
            name: agent.name,
            avatarMime: agent.avatarMime,
            avatarBase64: agent.avatarBase64,
          }}
          size="md"
          className="mt-0.5"
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold text-teal-950">{agent.name}</span>
            {archived ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-amber-950">
                Archived
              </span>
            ) : (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-emerald-900">
                Current
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-teal-800/65">
            {agent.skill ? <span>{agent.skill}</span> : null}
            <span className="uppercase tracking-wide">{agent.role}</span>
            <span>{agent.mode === "api" ? "API" : "browser"}</span>
            {agent.groupName ? <span>{agent.groupName}</span> : null}
          </div>
          <p className="mt-1 text-xs text-teal-900/60">
            {agent.chatCount} chat{agent.chatCount === 1 ? "" : "s"} · {agent.taskCount} task
            {agent.taskCount === 1 ? "" : "s"}
            {agent.doneTaskCount ? ` (${agent.doneTaskCount} done)` : ""}
            {agent.deletedAt
              ? ` · archived ${new Date(agent.deletedAt).toLocaleString()}`
              : null}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 sm:justify-end">
        <Link
          to={`/history/agents/${agent.id}`}
          className="inline-flex min-h-10 items-center rounded-xl bg-teal-700 px-3 text-xs font-semibold text-white"
        >
          View chat history
        </Link>
        <Link
          to={`/history/agents/${agent.id}/memory`}
          className="inline-flex min-h-10 items-center rounded-xl border border-violet-200 bg-violet-50 px-3 text-xs font-semibold text-violet-950"
        >
          View memory
        </Link>
        <Link
          to={`/history/agents/${agent.id}/memory#curated`}
          className="inline-flex min-h-10 items-center rounded-xl border border-sky-200 bg-sky-50 px-3 text-xs font-semibold text-sky-950"
        >
          Curated memory
        </Link>
        {!archived && agent.primaryChatId ? (
          <Link
            to={`/chats/${agent.primaryChatId}`}
            className="inline-flex min-h-10 items-center rounded-xl border border-teal-200 px-3 text-xs font-semibold text-teal-800"
          >
            Open chat
          </Link>
        ) : null}
        {archived && onRestore ? (
          <button
            type="button"
            disabled={busy}
            onClick={onRestore}
            className="min-h-10 rounded-xl border border-teal-200 px-3 text-xs font-semibold text-teal-800 disabled:opacity-50"
          >
            {busy ? "Restoring…" : "Restore"}
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function HistoryPage() {
  const [agents, setAgents] = useState([]);
  const [counts, setCounts] = useState({ current: 0, archived: 0 });
  const [query, setQuery] = useState("");
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api("/api/agents/history");
      setAgents(data.agents || []);
      setCounts(data.counts || { current: 0, archived: 0 });
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((a) =>
      [a.name, a.skill, a.role, a.groupName, a.mode].join(" ").toLowerCase().includes(q)
    );
  }, [agents, query]);

  const current = filtered.filter((a) => !a.archived);
  const archived = filtered.filter((a) => a.archived);

  /**
   * @param {string} id
   */
  async function restore(id) {
    setBusyId(id);
    setError(null);
    try {
      await api(`/api/agents/${id}/restore`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">History</h1>
        <p className="text-sm text-teal-900/70">
          Current agents and archived (deleted) agents. Deleting an agent retires it but keeps chats
          and tasks so you can review them here.
        </p>
      </div>

      <PageGuideBanner helpId="nav.history" />

      <div className="flex flex-wrap gap-2 text-xs font-semibold">
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-900">
          {counts.current} current
        </span>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-950">
          {counts.archived} archived
        </span>
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search agents…"
        className="min-h-11 rounded-xl border border-teal-200 bg-white px-3 text-sm"
      />

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}

      {loading ? <p className="text-sm text-teal-900/60">Loading history…</p> : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-teal-900/70">
          Current agents
        </h2>
        <ul className="flex flex-col gap-2">
          {current.map((a) => (
            <HistoryRow
              key={a.id}
              agent={a}
              archived={false}
              busy={busyId === a.id}
            />
          ))}
        </ul>
        {!loading && !current.length ? (
          <p className="text-sm text-teal-900/60">No current agents match.</p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-teal-900/70">
          Archived agents
        </h2>
        <ul className="flex flex-col gap-2">
          {archived.map((a) => (
            <HistoryRow
              key={a.id}
              agent={a}
              archived
              busy={busyId === a.id}
              onRestore={() => void restore(a.id)}
            />
          ))}
        </ul>
        {!loading && !archived.length ? (
          <p className="text-sm text-teal-900/60">
            No archived agents yet. When you delete an agent from Agents, it appears here with its
            chats intact.
          </p>
        ) : null}
      </section>
    </div>
  );
}
