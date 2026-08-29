/**
 * @fileoverview Chat list — agent-bound chats + common inbox.
 * Purpose: Start conversations bound to an agent or open a neutral common chat.
 * Downstream: GET /api/chats includes `live` activity for threads with pending/running tasks.
 */

import { useEffect, useMemo, useRef, useState } from "react";

/** Newest threads on first paint; scroll loads the previous page. */
const CHAT_PAGE = 100;
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { ButtonWithHelp, FieldLabel, PageGuideBanner } from "../components/FieldLabel.jsx";
import { GettingStartedCard } from "../components/GettingStartedCard.jsx";
import { useSetupStatus } from "../hooks/useSetupStatus.js";

/**
 * @param {object} chat
 * @returns {boolean}
 */
function isCommonChat(chat) {
  return chat?.kind === "common" || (!chat?.agent && chat?.kind !== "agent");
}

/**
 * Badge copy for a thread's live browser job.
 * @param {{ status?: string, goal?: string }|null|undefined} live
 * @returns {{ label: string, className: string, title: string }|null}
 */
function liveBadge(live) {
  if (!live?.status) return null;
  const goalHint = live.goal ? String(live.goal).slice(0, 80) : "Browser job in this thread";
  if (live.status === "running") {
    return {
      label: "Live",
      className: "bg-emerald-100 text-emerald-900",
      title: goalHint,
    };
  }
  if (live.status === "waiting_user") {
    return {
      label: "Needs you",
      className: "bg-amber-100 text-amber-950",
      title: goalHint,
    };
  }
  if (live.status === "pending") {
    return {
      label: "Queued",
      className: "bg-sky-100 text-sky-900",
      title: goalHint,
    };
  }
  return null;
}

export function ChatsPage() {
  const [chats, setChats] = useState([]);
  const [hasMoreChats, setHasMoreChats] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [agents, setAgents] = useState([]);
  const [agentId, setAgentId] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyCommon, setBusyCommon] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(false);
  const chatsRef = useRef([]);
  const navigate = useNavigate();
  const { complete: setupComplete, refresh: refreshSetup } = useSetupStatus();

  const { commonChats, agentChats } = useMemo(() => {
    const common = [];
    const agent = [];
    for (const c of chats) {
      if (isCommonChat(c)) common.push(c);
      else agent.push(c);
    }
    return { commonChats: common, agentChats: agent };
  }, [chats]);

  const workingCount = useMemo(
    () => chats.filter((c) => c.live?.status === "running" || c.live?.status === "waiting_user").length,
    [chats]
  );

  /**
   * @param {object[]} prev
   * @param {object[]} incoming
   * @returns {object[]}
   */
  function mergeChats(prev, incoming) {
    const map = new Map();
    for (const c of [...(incoming || []), ...(prev || [])]) {
      map.set(String(c._id), c);
    }
    return [...map.values()].sort((a, b) => {
      const ta = new Date(a.updatedAt).getTime();
      const tb = new Date(b.updatedAt).getTime();
      if (tb !== ta) return tb - ta;
      return String(b._id).localeCompare(String(a._id));
    });
  }

  async function load() {
    try {
      const [chatData, agentData] = await Promise.all([
        api(`/api/chats?limit=${CHAT_PAGE}`),
        api("/api/agents"),
      ]);
      const page = chatData.chats || [];
      setChats((prev) => (prev.length ? mergeChats(prev, page) : page));
      setHasMoreChats((had) =>
        chatsRef.current.length > CHAT_PAGE ? had : Boolean(chatData.hasMore)
      );
      const list = agentData.agents || [];
      setAgents(list);
      if (!agentId && list[0]?._id) setAgentId(list[0]._id);
    } catch (err) {
      setError(err);
    }
  }

  /**
   * Appends the next 100 older threads when the user reaches the top/end of history.
   */
  async function loadOlderChats() {
    if (loadingMoreRef.current || !hasMoreRef.current) return;
    const oldest = chatsRef.current[chatsRef.current.length - 1];
    if (!oldest?._id) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const data = await api(
        `/api/chats?limit=${CHAT_PAGE}&before=${encodeURIComponent(oldest._id)}`
      );
      const older = data.chats || [];
      setHasMoreChats(Boolean(data.hasMore));
      setChats((prev) => mergeChats(prev, older));
    } catch (err) {
      setError(err);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  useEffect(() => {
    hasMoreRef.current = hasMoreChats;
  }, [hasMoreChats]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    /**
     * Why: newest threads sit at the top; reaching the bottom (or the top after reading)
     * loads the previous 100. Also fire when the user scrolls up near the top with more pages.
     */
    function onWindowScroll() {
      const nearBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 240;
      if (nearBottom) void loadOlderChats();
    }
    window.addEventListener("scroll", onWindowScroll, { passive: true });
    return () => window.removeEventListener("scroll", onWindowScroll);
  }, []);

  /** Why: keep Live / Queued badges in sync while agents work without requiring a reload. */
  useEffect(() => {
    const id = window.setInterval(() => {
      load().catch(() => {});
    }, 5_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  async function createAgentChat() {
    if (!agentId) {
      setError({
        title: "Pick an agent",
        detail: "Create an agent first, then start a chat with it.",
        hint: "Open Agents → New agent.",
      });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await api("/api/chats", {
        method: "POST",
        body: JSON.stringify({ agentId, kind: "agent" }),
      });
      navigate(`/chats/${data.chat._id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function openCommonChat() {
    setBusyCommon(true);
    setError(null);
    try {
      if (commonChats[0]?._id) {
        navigate(`/chats/${commonChats[0]._id}`);
        return;
      }
      const data = await api("/api/chats", {
        method: "POST",
        body: JSON.stringify({ kind: "common", title: "Common chat" }),
      });
      navigate(`/chats/${data.chat._id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusyCommon(false);
    }
  }

  async function createAnotherCommonChat() {
    setBusyCommon(true);
    setError(null);
    try {
      const data = await api("/api/chats", {
        method: "POST",
        body: JSON.stringify({ kind: "common" }),
      });
      navigate(`/chats/${data.chat._id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusyCommon(false);
    }
  }

  /**
   * @param {object} chat
   */
  async function deleteChat(chat) {
    const label = chat.title || "this chat";
    if (
      !window.confirm(
        `Delete “${label}”? Messages and queued goals for this thread will be removed. Running work from this thread will be stopped.`
      )
    ) {
      return;
    }
    setDeletingId(chat._id);
    setError(null);
    try {
      await api(`/api/chats/${chat._id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setDeletingId("");
    }
  }

  /**
   * @param {object[]} list
   * @param {string} emptyText
   */
  function renderChatList(list, emptyText) {
    if (!list.length) {
      return (
        <li className="rounded-2xl border border-dashed border-teal-200 bg-white/70 p-4 text-sm text-teal-900/70">
          {emptyText}
        </li>
      );
    }
    return list.map((c) => {
      const badge = liveBadge(c.live);
      const isWorking = c.live?.status === "running" || c.live?.status === "waiting_user";
      return (
        <li
          key={c._id}
          className={`flex min-w-0 flex-col gap-2 rounded-2xl border bg-white p-2 shadow-sm sm:flex-row sm:items-center sm:gap-3 sm:p-3 ${
            isWorking ? "border-emerald-300 ring-1 ring-emerald-100" : "border-teal-100"
          }`}
        >
          <Link
            to={`/chats/${c._id}`}
            className="flex min-h-11 min-w-0 flex-1 flex-col gap-1 px-1 py-1 sm:flex-row sm:items-center sm:justify-between sm:px-2"
          >
            <span className="flex min-w-0 items-center gap-2 truncate font-semibold">
              {badge ? (
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide ${badge.className}`}
                  title={badge.title}
                >
                  {c.live?.status === "running" ? (
                    <span
                      className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current"
                      aria-hidden
                    />
                  ) : null}
                  {badge.label}
                </span>
              ) : null}
              {c.title?.startsWith("Trigger ·") ? (
                <span className="shrink-0 rounded-md bg-violet-100 px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-violet-900">
                  Ops
                </span>
              ) : null}
              <span className="truncate">{c.title}</span>
            </span>
            <span className="shrink-0 text-xs text-teal-900/60">
              {isCommonChat(c) ? "Common · " : c.agent?.name ? `${c.agent.name} · ` : ""}
              {new Date(c.updatedAt).toLocaleString()}
            </span>
          </Link>
          <ButtonWithHelp helpId="chats.delete">
            <button
              type="button"
              disabled={Boolean(deletingId)}
              onClick={() => deleteChat(c)}
              className="inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 disabled:opacity-50 sm:w-auto"
            >
              {deletingId === c._id ? "Deleting…" : "Delete"}
            </button>
          </ButtonWithHelp>
        </li>
      );
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6 lg:max-w-4xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Chats</h1>
          <p className="text-sm text-teal-900/70">
            Send goals in plain English — agents run them in cloud browsers.{" "}
            <strong>Agent chats</strong> bind one worker per thread.{" "}
            <strong>Shared inbox</strong> lets you pick an agent per message.
            {workingCount > 0 ? (
              <>
                {" "}
                <span className="font-semibold text-emerald-800">
                  {workingCount} thread{workingCount === 1 ? "" : "s"} working now.
                </span>
              </>
            ) : null}
          </p>
        </div>
      </div>

      <GettingStartedCard compact onAgentCreated={refreshSetup} />

      {!setupComplete ? (
        <div className="rounded-2xl border border-teal-100 bg-teal-50/40 p-4 text-sm text-teal-900/75">
          Finish the steps above to unlock chat creation, or open{" "}
          <Link to="/start" className="font-semibold text-teal-800 underline">
            Get started
          </Link>{" "}
          for the full walkthrough.
        </div>
      ) : (
        <>
          <PageGuideBanner helpId="chats.page" />

          <section className="flex flex-col gap-2 rounded-2xl border border-violet-100 bg-violet-50/40 p-3 shadow-sm sm:p-4">
            <h2 className="text-sm font-bold text-violet-950">Shared inbox</h2>
            <p className="text-xs text-violet-950/80">
              One thread — choose which agent handles each goal.
            </p>
            <div className="flex flex-wrap gap-2">
              <ButtonWithHelp helpId="chats.commonChat">
                <button
                  type="button"
                  disabled={busyCommon}
                  onClick={openCommonChat}
                  className="min-h-11 rounded-xl bg-violet-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busyCommon ? "Opening…" : commonChats.length ? "Open shared inbox" : "Start shared inbox"}
                </button>
              </ButtonWithHelp>
              {commonChats.length ? (
                <button
                  type="button"
                  disabled={busyCommon}
                  onClick={createAnotherCommonChat}
                  className="min-h-11 rounded-xl border border-violet-200 bg-white px-4 text-sm font-semibold text-violet-900 disabled:opacity-50"
                >
                  New shared thread
                </button>
              ) : null}
            </div>
          </section>

          <section className="flex flex-col gap-2 rounded-2xl border border-teal-100 bg-white p-3 shadow-sm sm:p-4">
            <h2 className="text-sm font-bold text-teal-950">New agent chat</h2>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="flex w-full min-w-0 flex-col gap-1 text-sm sm:flex-1">
                <FieldLabel helpId="chats.agentSelect">Agent</FieldLabel>
                <select
                  className="min-h-11 w-full rounded-xl border border-teal-100 px-3"
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                >
                  {agents.length === 0 ? (
                    <option value="">No agents yet</option>
                  ) : (
                    agents.map((a) => (
                      <option key={a._id} value={a._id}>
                        {a.name} ({a.skill})
                      </option>
                    ))
                  )}
                </select>
              </label>
              <ButtonWithHelp helpId="chats.newChat">
                <button
                  type="button"
                  disabled={busy || !agentId}
                  onClick={createAgentChat}
                  className="min-h-11 w-full rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50 sm:w-auto"
                >
                  {busy ? "Creating…" : "New agent chat"}
                </button>
              </ButtonWithHelp>
              <ButtonWithHelp helpId="chats.newAgentLink">
                <Link
                  to="/agents/new"
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-teal-100 px-4 text-sm font-semibold sm:w-auto"
                >
                  New agent
                </Link>
              </ButtonWithHelp>
            </div>
          </section>

          <div className="break-words rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <strong>Tip:</strong> Watch all agent browsers on{" "}
            <Link to="/live" className="font-semibold underline">
              Live Wall
            </Link>
            .
          </div>
        </>
      )}

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}

      {setupComplete ? (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-bold text-teal-900/80">Shared inbox</h2>
            <ul className="flex flex-col gap-2">
              {renderChatList(commonChats, "No shared inbox threads yet — start one above.")}
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-bold text-teal-900/80">Agent chats</h2>
            <ul className="flex flex-col gap-2">
              {renderChatList(agentChats, "No agent chats yet. Pick an agent and start a chat.")}
            </ul>
            {loadingMore ? (
              <p className="py-2 text-center text-xs text-teal-900/60">Loading earlier threads…</p>
            ) : hasMoreChats ? (
              <button
                type="button"
                onClick={() => void loadOlderChats()}
                className="min-h-11 rounded-xl border border-teal-100 bg-white text-sm font-semibold text-teal-900"
              >
                Load earlier threads
              </button>
            ) : chats.length > 0 ? (
              <p className="py-2 text-center text-xs text-teal-900/40">All threads loaded</p>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
