/**
 * @fileoverview Live cloud-computer screen viewer for the YamBot dashboard.
 * Purpose: Poll `/api/agents/:id/live` and show the latest JPEG from the VPS Chromium box.
 * Inputs: agentId; Downstream: Agent edit + Chat detail pages.
 */

import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

/**
 * @param {{ agentId: string, compact?: boolean, className?: string }} props
 */
export function LiveScreen({ agentId, compact = false, className = "" }) {
  const [live, setLive] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!agentId) return undefined;
    let cancelled = false;

    async function tick() {
      try {
        const data = await api(`/api/agents/${agentId}/live`);
        if (!cancelled) {
          setLive(data.live || null);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    }

    tick();
    const id = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [agentId]);

  if (!agentId) return null;

  const src =
    live?.dataBase64 && live?.mime
      ? `data:${live.mime};base64,${live.dataBase64}`
      : null;

  return (
    <section
      className={`overflow-hidden rounded-2xl border border-teal-100 bg-slate-950 text-white shadow-sm ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2 text-xs">
        <div className="flex items-center gap-2 font-semibold tracking-wide">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              live?.online ? "bg-emerald-400" : "bg-slate-500"
            }`}
            title={live?.online ? "Cloud computer online" : "Cloud computer offline"}
          />
          {live?.online ? "LIVE" : "OFFLINE"}
          {live?.workerName ? (
            <span className="font-normal text-white/60">· {live.workerName}</span>
          ) : null}
        </div>
        {live?.pageUrl ? (
          <span className="max-w-full truncate text-white/50" title={live.pageUrl}>
            {live.pageUrl}
          </span>
        ) : null}
      </div>

      <div
        className={`relative flex items-center justify-center bg-black ${
          compact ? "min-h-40" : "min-h-52 md:min-h-72"
        }`}
      >
        {src ? (
          <img
            src={src}
            alt="Agent cloud computer screen"
            className="max-h-[50vh] w-full object-contain md:max-h-[60vh]"
          />
        ) : (
          <p className="px-4 py-10 text-center text-sm text-white/60">
            {error
              ? error.detail || error.message || "Could not load live screen"
              : live?.online
                ? "Waiting for first screenshot…"
                : "Start this agent’s cloud worker to watch its screen here."}
          </p>
        )}
      </div>
    </section>
  );
}
