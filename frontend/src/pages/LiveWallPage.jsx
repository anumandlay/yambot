/**
 * @fileoverview Live Wall — all cloud agent screens with Zoom / Take control.
 * Purpose: Remote-desktop overview; red blink when CAPTCHA / ask_user needs you.
 * Downstream: GET /api/agents/live-wall + LiveScreen control APIs.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { LiveScreen } from "../components/LiveScreen.jsx";

export function LiveWallPage() {
  const [screens, setScreens] = useState([]);
  const [attentionCount, setAttentionCount] = useState(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const data = await api("/api/agents/live-wall");
        if (cancelled) return;
        setScreens(data.screens || []);
        setAttentionCount(Number(data.attentionCount) || 0);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err);
      }
    }

    tick();
    const id = setInterval(tick, 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Live Wall</h1>
          <p className="text-sm text-teal-900/70">
            All cloud computers. Use <strong>Zoom</strong> and <strong>Take control</strong> like a
            remote desktop. Screens that need you (CAPTCHA, questions) blink red.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {attentionCount > 0 ? (
            <span className="inline-flex min-h-11 items-center rounded-xl bg-red-600 px-3 text-sm font-bold text-white">
              {attentionCount} need{attentionCount === 1 ? "s" : ""} you
            </span>
          ) : (
            <span className="inline-flex min-h-11 items-center rounded-xl border border-teal-100 bg-white px-3 text-sm font-semibold text-teal-900/70">
              All clear
            </span>
          )}
          <Link
            to="/agents"
            className="inline-flex min-h-11 items-center rounded-xl border border-teal-100 bg-white px-3 text-sm font-semibold text-teal-900"
          >
            Agents
          </Link>
        </div>
      </div>

      {error ? <ErrorAlert error={error} /> : null}

      {!screens.length && !error ? (
        <p className="rounded-2xl border border-teal-100 bg-white/80 p-6 text-sm text-teal-900/70">
          No cloud agents yet.{" "}
          <Link to="/agents/new" className="font-semibold text-teal-800 underline">
            Create an agent
          </Link>{" "}
          to provision a computer.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {screens.map((s) => (
          <div key={s.id} className="flex min-h-0 flex-col gap-2">
            <div className="flex min-w-0 items-center justify-between gap-2 px-0.5">
              <Link
                to={`/agents/${s.id}`}
                className="min-w-0 truncate text-sm font-bold text-teal-950 hover:underline"
              >
                {s.name}
              </Link>
              <span
                className={`shrink-0 text-[0.65rem] font-semibold uppercase tracking-wide ${
                  s.needsAttention
                    ? "text-red-600"
                    : s.online
                      ? "text-emerald-700"
                      : "text-teal-900/50"
                }`}
              >
                {s.needsAttention ? "Attention" : s.online ? "Online" : "Offline"}
              </span>
            </div>
            <LiveScreen
              agentId={s.id}
              agentName={s.name}
              compact
              wallMode
              attention={Boolean(s.needsAttention)}
              attentionReason={s.attentionReason || ""}
              className="min-h-[16rem] sm:min-h-[18rem]"
            />
            {s.pageUrl ? (
              <p className="truncate px-0.5 text-[0.7rem] text-teal-900/50" title={s.pageUrl}>
                {s.pageUrl}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
