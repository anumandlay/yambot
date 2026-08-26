/**
 * @fileoverview Chat list — agent-bound chats + common inbox.
 * Purpose: Start conversations bound to an agent or open a neutral common chat.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { ButtonWithHelp, FieldLabel, PageGuideBanner } from "../components/FieldLabel.jsx";

/**
 * @param {object} chat
 * @returns {boolean}
 */
function isCommonChat(chat) {
  return chat?.kind === "common" || (!chat?.agent && chat?.kind !== "agent");
}

export function ChatsPage() {
  const [chats, setChats] = useState([]);
  const [agents, setAgents] = useState([]);
  const [agentId, setAgentId] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyCommon, setBusyCommon] = useState(false);
  const navigate = useNavigate();

  const { commonChats, agentChats } = useMemo(() => {
    const common = [];
    const agent = [];
    for (const c of chats) {
      if (isCommonChat(c)) common.push(c);
      else agent.push(c);
    }
    return { commonChats: common, agentChats: agent };
  }, [chats]);

  async function load() {
    try {
      const [chatData, agentData] = await Promise.all([
        api("/api/chats"),
        api("/api/agents"),
      ]);
      setChats(chatData.chats || []);
      const list = agentData.agents || [];
      setAgents(list);
      if (!agentId && list[0]?._id) setAgentId(list[0]._id);
    } catch (err) {
      setError(err);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    return list.map((c) => (
      <li key={c._id}>
        <Link
          to={`/chats/${c._id}`}
          className="flex min-h-11 min-w-0 flex-col gap-1 rounded-2xl border border-teal-100 bg-white px-3 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-4"
        >
          <span className="truncate font-semibold">{c.title}</span>
          <span className="shrink-0 text-xs text-teal-900/60">
            {isCommonChat(c) ? "Common · " : c.agent?.name ? `${c.agent.name} · ` : ""}
            {new Date(c.updatedAt).toLocaleString()}
          </span>
        </Link>
      </li>
    ));
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6 lg:max-w-4xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Chats</h1>
          <p className="text-sm text-teal-900/70">
            <strong>Common chat</strong> — pick an agent per message. <strong>Agent chats</strong> — one
            dedicated worker per thread.
          </p>
        </div>
      </div>

      <PageGuideBanner helpId="chats.page" />

      <section className="flex flex-col gap-2 rounded-2xl border border-violet-100 bg-violet-50/40 p-3 shadow-sm sm:p-4">
        <h2 className="text-sm font-bold text-violet-950">Common chat</h2>
        <p className="text-xs text-violet-950/80">
          One inbox — dispatch each goal to whichever agent you choose.
        </p>
        <div className="flex flex-wrap gap-2">
          <ButtonWithHelp helpId="chats.commonChat">
            <button
              type="button"
              disabled={busyCommon}
              onClick={openCommonChat}
              className="min-h-11 rounded-xl bg-violet-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busyCommon ? "Opening…" : commonChats.length ? "Open common chat" : "Start common chat"}
            </button>
          </ButtonWithHelp>
          {commonChats.length ? (
            <button
              type="button"
              disabled={busyCommon}
              onClick={createAnotherCommonChat}
              className="min-h-11 rounded-xl border border-violet-200 bg-white px-4 text-sm font-semibold text-violet-900 disabled:opacity-50"
            >
              New common thread
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
        <strong>Cloud workers:</strong> Each agent has a dedicated Chromium box on the VPS. Goals queue
        per agent — watch progress on{" "}
        <Link to="/live" className="font-semibold underline">
          Live Wall
        </Link>
        .
      </div>

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold text-teal-900/80">Common</h2>
        <ul className="flex flex-col gap-2">
          {renderChatList(commonChats, "No common chats yet — start one above.")}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-bold text-teal-900/80">Agent chats</h2>
        <ul className="flex flex-col gap-2">
          {renderChatList(agentChats, "No agent chats yet. Pick an agent and start a chat.")}
        </ul>
      </section>
    </div>
  );
}
