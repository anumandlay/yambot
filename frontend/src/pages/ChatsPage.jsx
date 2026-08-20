/**
 * @fileoverview Chat list + create-new-chat entry point.
 * Purpose: Start conversations that enqueue browser goals for the extension.
 */

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, getToken } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";

export function ChatsPage() {
  const [chats, setChats] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function load() {
    try {
      const data = await api("/api/chats");
      setChats(data.chats || []);
    } catch (err) {
      setError(err);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createChat() {
    setBusy(true);
    setError(null);
    try {
      const data = await api("/api/chats", {
        method: "POST",
        body: JSON.stringify({ title: "New chat" }),
      });
      navigate(`/chats/${data.chat._id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 md:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Chats</h1>
          <p className="text-sm text-teal-900/70">
            Create a chat, send a goal, watch results while Chrome runs the agent.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={createChat}
          className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Creating…" : "New chat"}
        </button>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        <strong>Extension pairing:</strong> Copy your session token and paste it into the YamBot
        Chrome extension Settings (API URL + Auth token). Keep Chrome open so queued goals run.
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="min-h-11 rounded-xl border border-amber-300 bg-white px-3 font-semibold"
            onClick={async () => {
              const token = getToken();
              if (!token) return;
              await navigator.clipboard.writeText(token);
              alert("Token copied. Paste it into the extension Settings → Auth token.");
            }}
          >
            Copy login token
          </button>
        </div>
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
            No chats yet. Create one to send your first goal.
          </li>
        ) : (
          chats.map((c) => (
            <li key={c._id}>
              <Link
                to={`/chats/${c._id}`}
                className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-teal-100 bg-white px-4 py-3 shadow-sm"
              >
                <span className="font-semibold">{c.title}</span>
                <span className="text-xs text-teal-900/60">
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
