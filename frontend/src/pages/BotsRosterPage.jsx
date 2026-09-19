/**
 * @fileoverview Bots roster — Hermes-style company directory of agents.
 * Purpose: See who exists, live status, and jump to chat / room / edit.
 * Downstream: GET /api/agents/roster, GET/PATCH /api/rooms, POST /api/chats.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { PageGuideBanner } from "../components/FieldLabel.jsx";
import { AgentAvatar } from "../components/AgentAvatar.jsx";

/**
 * @param {string} status
 * @returns {{ label: string, className: string, dot: string }}
 */
function statusBadge(status) {
  if (status === "needs_you") {
    return {
      label: "Needs you",
      className: "bg-amber-100 text-amber-950",
      dot: "bg-red-500 animate-pulse",
    };
  }
  if (status === "working") {
    return {
      label: "Working",
      className: "bg-emerald-100 text-emerald-900",
      dot: "bg-emerald-500 animate-pulse",
    };
  }
  if (status === "online") {
    return {
      label: "Online",
      className: "bg-sky-100 text-sky-900",
      dot: "bg-sky-500",
    };
  }
  return {
    label: "Idle",
    className: "bg-teal-50 text-teal-800/70",
    dot: "bg-teal-300",
  };
}

export function BotsRosterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const inGrok = location.pathname.startsWith("/grok");
  const roomsBase = inGrok ? "/grok/rooms" : "/rooms";

  const [bots, setBots] = useState([]);
  const [counts, setCounts] = useState({ total: 0, needsYou: 0, working: 0 });
  const [rooms, setRooms] = useState([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState("");
  const [roomPickerFor, setRoomPickerFor] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [roster, roomsData] = await Promise.all([
        api("/api/agents/roster"),
        api("/api/rooms").catch(() => ({ rooms: [] })),
      ]);
      setBots(roster.bots || []);
      setCounts(roster.counts || { total: 0, needsYou: 0, working: 0 });
      setRooms(roomsData.rooms || []);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load().catch(() => {}), 5000);
    return () => window.clearInterval(t);
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bots;
    return bots.filter((b) => {
      const blob = [b.name, b.skill, b.role, b.mode, b.groupName, b.description]
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [bots, query]);

  /**
   * @param {object} bot
   */
  async function openChat(bot) {
    const id = String(bot.id);
    setBusyId(id);
    setError(null);
    try {
      if (bot.chatId && inGrok) {
        navigate(`/grok/${bot.chatId}`);
        return;
      }
      if (bot.chatId && !inGrok) {
        navigate(`/chats/${bot.chatId}`);
        return;
      }
      const data = await api("/api/chats", {
        method: "POST",
        body: JSON.stringify({ agentId: id, kind: "agent" }),
      });
      const chatId = data.chat?._id;
      navigate(inGrok ? `/grok/${chatId}` : `/chats/${chatId}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusyId("");
    }
  }

  /**
   * Ask = open that bot’s chat (composer ready).
   * @param {object} bot
   */
  async function askBot(bot) {
    await openChat(bot);
  }

  /**
   * @param {object} bot
   * @param {object} room
   */
  async function addToRoom(bot, room) {
    const agentId = String(bot.id);
    const members = (room.participantAgents || [])
      .map((a) => (typeof a === "object" ? String(a._id) : String(a)))
      .filter(Boolean);
    if (members.includes(agentId)) {
      setRoomPickerFor(null);
      navigate(`${roomsBase}/${room._id}`);
      return;
    }
    if (members.length >= 8) {
      setError({
        title: "Room full",
        detail: "Rooms support up to 8 agents.",
      });
      return;
    }
    setBusyId(agentId);
    setError(null);
    try {
      await api(`/api/rooms/${room._id}`, {
        method: "PATCH",
        body: JSON.stringify({ participantAgentIds: [...members, agentId] }),
      });
      setRoomPickerFor(null);
      navigate(`${roomsBase}/${room._id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Bots roster</h1>
        <p className="text-sm text-teal-900/70">
          Company directory of your agents — who they are, whether they’re busy, and quick actions
          to chat or add them to a group room.
        </p>
      </div>

      <PageGuideBanner helpId="nav.bots" />

      <div className="flex flex-wrap gap-2 text-xs font-semibold">
        <span className="rounded-full bg-teal-50 px-3 py-1 text-teal-900">
          {counts.total} bots
        </span>
        {counts.needsYou ? (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-950">
            {counts.needsYou} need you
          </span>
        ) : null}
        {counts.working ? (
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-900">
            {counts.working} working
          </span>
        ) : null}
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search name, skill, group…"
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

      {loading && !bots.length ? (
        <p className="text-sm text-teal-900/60">Loading roster…</p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {visible.map((bot) => {
          const badge = statusBadge(bot.status);
          const busy = busyId === String(bot.id);
          return (
            <li
              key={bot.id}
              className="rounded-2xl border border-teal-100 bg-white p-3 shadow-sm sm:p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <AgentAvatar agent={bot} size="md" className="mt-0.5" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold text-teal-950">{bot.name}</span>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide ${badge.className}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
                        {badge.label}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-teal-800/65">
                      {bot.skill ? <span>{bot.skill}</span> : null}
                      <span className="uppercase tracking-wide">{bot.role}</span>
                      <span>{bot.mode === "api" ? "API" : "browser"}</span>
                      {bot.groupName ? <span>{bot.groupName}</span> : null}
                    </div>
                    {bot.description ? (
                      <p className="mt-1 line-clamp-2 text-xs text-teal-900/70">{bot.description}</p>
                    ) : null}
                    {bot.needsAttention && bot.attentionReason ? (
                      <p className="mt-1 text-xs font-medium text-amber-900">
                        {bot.attentionReason}
                      </p>
                    ) : bot.liveGoal ? (
                      <p className="mt-1 truncate text-xs text-teal-900/55" title={bot.liveGoal}>
                        {bot.liveGoal}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void openChat(bot)}
                    className="min-h-10 rounded-xl bg-teal-700 px-3 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Open chat
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void askBot(bot)}
                    className="min-h-10 rounded-xl border border-teal-200 px-3 text-xs font-semibold text-teal-800 disabled:opacity-50"
                  >
                    Ask
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setRoomPickerFor(bot)}
                    className="min-h-10 rounded-xl border border-teal-200 px-3 text-xs font-semibold text-teal-800 disabled:opacity-50"
                  >
                    Add to room
                  </button>
                  <Link
                    to={`/agents/${bot.id}`}
                    className="inline-flex min-h-10 items-center rounded-xl border border-teal-100 px-3 text-xs font-semibold text-teal-700"
                  >
                    Edit
                  </Link>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {!loading && !visible.length ? (
        <p className="text-sm text-teal-900/60">
          No bots match.{" "}
          <Link to="/agents/new" className="font-semibold text-teal-700 underline">
            Create an agent
          </Link>
        </p>
      ) : null}

      {roomPickerFor ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
          <div
            className="w-full max-w-md rounded-2xl bg-white p-4 shadow-lg"
            role="dialog"
            aria-labelledby="room-picker-title"
          >
            <h2 id="room-picker-title" className="text-base font-bold text-teal-950">
              Add {roomPickerFor.name} to a room
            </h2>
            <p className="mt-1 text-xs text-teal-900/65">
              Pick an existing group room, or create one first.
            </p>
            <ul className="mt-3 flex max-h-56 flex-col gap-1 overflow-y-auto">
              {rooms.map((room) => (
                <li key={room._id}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center rounded-xl border border-teal-100 px-3 text-left text-sm font-semibold text-teal-950 hover:bg-teal-50"
                    onClick={() => void addToRoom(roomPickerFor, room)}
                  >
                    {room.title}
                  </button>
                </li>
              ))}
            </ul>
            {!rooms.length ? (
              <p className="mt-2 text-sm text-teal-900/60">No rooms yet.</p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                to={roomsBase}
                className="inline-flex min-h-10 items-center rounded-xl bg-teal-700 px-3 text-xs font-semibold text-white"
                onClick={() => setRoomPickerFor(null)}
              >
                Manage rooms
              </Link>
              <button
                type="button"
                className="min-h-10 rounded-xl border border-teal-200 px-3 text-xs font-semibold text-teal-800"
                onClick={() => setRoomPickerFor(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
