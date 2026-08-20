/**
 * @fileoverview Chat list + create-new-chat entry point.
 * Purpose: Start conversations bound to an agent that enqueue browser goals.
 */

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";

export function ChatsPage() {
  const [chats, setChats] = useState([]);
  const [agents, setAgents] = useState([]);
  const [agentId, setAgentId] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

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

  async function createChat() {
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
        body: JSON.stringify({ agentId }),
      });
      navigate(`/chats/${data.chat._id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Chats</h1>
          <p className="text-sm text-teal-900/70">
            Pick an agent, start a chat, send a goal — Chrome runs it with that agent’s playbook.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-2xl border border-teal-100 bg-white p-3 shadow-sm sm:flex-row sm:items-end sm:p-4">
        <label className="flex w-full min-w-0 flex-col gap-1 text-sm sm:flex-1">
          Agent
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
        <button
          type="button"
          disabled={busy || !agentId}
          onClick={createChat}
          className="min-h-11 w-full rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50 sm:w-auto"
        >
          {busy ? "Creating…" : "New chat"}
        </button>
        <Link
          to="/agents/new"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-teal-100 px-4 text-sm font-semibold sm:w-auto"
        >
          New agent
        </Link>
      </div>

      <div className="break-words rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        <strong>Runners:</strong> Agents can use your Chrome extension and/or a cloud Chromium box on
        the VPS. Set this on Agents → Computer. Extension API URL:{" "}
        <code className="break-all rounded bg-white px-1">https://bot.vughy.com</code>.
      </div>

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}

      <ul className="flex flex-col gap-2">
        {chats.length === 0 ? (
          <li className="rounded-2xl border border-dashed border-teal-200 bg-white/70 p-6 text-sm text-teal-900/70">
            No chats yet. Create an agent, then start a chat.
          </li>
        ) : (
          chats.map((c) => (
            <li key={c._id}>
              <Link
                to={`/chats/${c._id}`}
                className="flex min-h-11 min-w-0 flex-col gap-1 rounded-2xl border border-teal-100 bg-white px-3 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-4"
              >
                <span className="truncate font-semibold">{c.title}</span>
                <span className="shrink-0 text-xs text-teal-900/60">
                  {c.agent?.name ? `${c.agent.name} · ` : ""}
                  {new Date(c.updatedAt).toLocaleString()}
                </span>
              </Link>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
