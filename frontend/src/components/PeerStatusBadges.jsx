/**
 * @fileoverview Compact peer-delegation status badges under the live agent screen (A2A v4).
 * Purpose: Show “Waiting on B” / “B replied” from Task.pendingPeerResults; expand for the result text.
 * Downstream: ChatDetailPage agent rail.
 */

import { useMemo, useState } from "react";

/**
 * @param {{
 *   peers?: object[]|null,
 *   className?: string,
 * }} props
 */
export function PeerStatusBadges({ peers = null, className = "" }) {
  const rows = useMemo(() => {
    const list = Array.isArray(peers) ? peers : [];
    return list
      .filter((p) => p && (p.status === "waiting" || p.status === "done" || p.status === "error"))
      .slice(-6);
  }, [peers]);

  const [openId, setOpenId] = useState(/** @type {string|null} */ (null));

  if (!rows.length) return null;

  const openRow = rows.find((r) => String(r.agentMessageId) === openId) || null;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        {rows.map((row) => {
          const id = String(row.agentMessageId || "");
          const name = String(row.toAgentName || "peer").slice(0, 24);
          const waiting = row.status === "waiting";
          const failed = row.status === "error";
          const soft = row.waitMode === "soft" && waiting;
          const label = waiting
            ? soft
              ? `Soft wait · ${name}`
              : `Waiting on ${name}`
            : failed
              ? `${name} failed`
              : `${name} replied`;
          const active = openId === id;
          return (
            <button
              key={id || `${name}-${row.status}`}
              type="button"
              title={label}
              aria-pressed={active}
              onClick={() => setOpenId(active ? null : id)}
              className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold ${
                waiting
                  ? "border-amber-300 bg-amber-50 text-amber-950"
                  : failed
                    ? "border-red-300 bg-red-50 text-red-950"
                    : "border-emerald-300 bg-emerald-50 text-emerald-950"
              } ${active ? "ring-2 ring-teal-400 ring-offset-1" : ""}`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                  waiting
                    ? "animate-pulse bg-amber-500"
                    : failed
                      ? "bg-red-500"
                      : "bg-emerald-500"
                }`}
              />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>
      {openRow ? (
        <div className="overflow-hidden rounded-2xl border border-teal-100 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-teal-50 px-3 py-2">
            <span className="text-xs font-semibold text-teal-950">
              {openRow.status === "waiting"
                ? `Waiting on ${openRow.toAgentName || "peer"}`
                : openRow.status === "error"
                  ? `${openRow.toAgentName || "peer"} failed`
                  : `${openRow.toAgentName || "peer"} replied`}
              {openRow.waitMode === "soft" ? " · soft" : ""}
            </span>
            <button
              type="button"
              onClick={() => setOpenId(null)}
              className="rounded-lg px-2 py-0.5 text-xs font-semibold text-teal-800/70 hover:bg-teal-50"
            >
              Close
            </button>
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[0.68rem] text-teal-950">
            {openRow.status === "waiting"
              ? openRow.contentPreview
                ? `Asked: ${openRow.contentPreview}`
                : "Peer still working…"
              : String(openRow.resultSummary || "(empty result)").slice(0, 4000)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
