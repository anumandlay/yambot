/**
 * @fileoverview Group rooms list + create — Hermes-style multi-agent channels.
 * Purpose: Create rooms with 2+ agents and open the shared transcript.
 * Downstream: GET/POST /api/rooms; RoomDetailPage.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { ButtonWithHelp, FieldLabel, PageGuideBanner } from "../components/FieldLabel.jsx";
import { AgentAvatar } from "../components/AgentAvatar.jsx";

/**
 * @param {object} room
 * @returns {string}
 */
function memberLabel(room) {
  const names = (room.participantAgents || [])
    .map((a) => (typeof a === "object" ? a.name : null))
    .filter(Boolean);
  return names.length ? names.join(" · ") : "No members";
}

export function RoomsPage() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);
  const [agents, setAgents] = useState([]);
  const [title, setTitle] = useState("Website Ops");
  const [selected, setSelected] = useState(() => new Set());
  const [facilitatorId, setFacilitatorId] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [roomsData, agentsData] = await Promise.all([
        api("/api/rooms"),
        api("/api/agents"),
      ]);
      setRooms(roomsData.rooms || []);
      const list = agentsData.agents || [];
      setAgents(Array.isArray(list) ? list.filter((a) => a.active !== false) : []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * @param {string} id
   */
  function toggleMember(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    if (selected.size && (!facilitatorId || !selected.has(facilitatorId))) {
      setFacilitatorId([...selected][0]);
    }
  }, [selected, facilitatorId]);

  async function createRoom(e) {
    e.preventDefault();
    if (selected.size < 2) {
      setError({
        title: "Need members",
        detail: "Select at least two agents.",
      });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await api("/api/rooms", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim() || "Group room",
          participantAgentIds: [...selected],
          facilitatorAgentId: facilitatorId || [...selected][0],
        }),
      });
      navigate(`/rooms/${data.room._id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function deleteRoom(id) {
    if (!window.confirm("Delete this room and its messages?")) return;
    setError(null);
    try {
      await api(`/api/rooms/${id}`, { method: "DELETE" });
      setRooms((prev) => prev.filter((r) => String(r._id) !== String(id)));
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Group rooms</h1>
        <p className="text-sm text-teal-900/70">
          Shared channels for a fixed set of agents. Members reply or PASS; @mention + browse work
          can delegate to a worker.
        </p>
      </div>

      <PageGuideBanner helpId="nav.rooms" />

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}

      <form
        onSubmit={createRoom}
        className="flex flex-col gap-3 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm"
      >
        <FieldLabel helpId="rooms.create">New room</FieldLabel>
        <input
          className="min-h-11 rounded-xl border border-teal-200 px-3 text-sm"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Room name"
          maxLength={80}
        />
        <p className="text-xs text-teal-900/60">Select 2–8 agents</p>
        <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
          {agents.map((a) => {
            const id = String(a._id);
            const on = selected.has(id);
            return (
              <li key={id}>
                <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-xl px-2 hover:bg-teal-50">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleMember(id)}
                  />
                  <AgentAvatar agent={a} size="sm" />
                  <span className="text-sm font-semibold text-teal-950">{a.name}</span>
                </label>
              </li>
            );
          })}
        </ul>
        {selected.size >= 2 ? (
          <label className="flex flex-col gap-1 text-xs font-semibold text-teal-900/70">
            Facilitator (sends delegated work)
            <select
              className="min-h-10 rounded-xl border border-teal-200 px-2 text-sm font-normal text-teal-950"
              value={facilitatorId}
              onChange={(e) => setFacilitatorId(e.target.value)}
            >
              {[...selected].map((id) => {
                const a = agents.find((x) => String(x._id) === id);
                return (
                  <option key={id} value={id}>
                    {a?.name || id}
                  </option>
                );
              })}
            </select>
          </label>
        ) : null}
        <ButtonWithHelp helpId="rooms.create">
          <button
            type="submit"
            disabled={busy || selected.size < 2}
            className="min-h-11 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create room"}
          </button>
        </ButtonWithHelp>
      </form>

      {loading ? <p className="text-sm text-teal-900/60">Loading rooms…</p> : null}

      <ul className="flex flex-col gap-2">
        {rooms.map((room) => (
          <li
            key={room._id}
            className="flex items-center gap-2 rounded-2xl border border-teal-100 bg-white p-3 shadow-sm"
          >
            <Link
              to={`/rooms/${room._id}`}
              className="min-w-0 flex-1 hover:opacity-90"
            >
              <div className="truncate font-semibold text-teal-950">{room.title}</div>
              <div className="truncate text-xs text-teal-900/60">{memberLabel(room)}</div>
            </Link>
            <button
              type="button"
              className="min-h-10 shrink-0 rounded-xl border border-teal-200 px-3 text-xs font-semibold text-teal-800"
              onClick={() => void deleteRoom(room._id)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      {!loading && !rooms.length ? (
        <p className="text-sm text-teal-900/60">No rooms yet — create one above.</p>
      ) : null}
    </div>
  );
}
