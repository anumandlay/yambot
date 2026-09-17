/**
 * @fileoverview Full-page live Zoom for one agent (pop-out from Zoom button).
 * Purpose: Open `/agents/:agentId/live` in a new tab; auto-enters view-only noVNC Zoom.
 * Inputs: Route param agentId; Downstream: LiveScreen + `/api/agents/:id` name lookup.
 */

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { LiveScreen } from "../components/LiveScreen.jsx";

/**
 * Detached live desktop tab — same Zoom experience as the in-app modal.
 * @returns {JSX.Element}
 */
export function AgentLivePage() {
  const { agentId } = useParams();
  const [agentName, setAgentName] = useState("");

  useEffect(() => {
    if (!agentId) return undefined;
    let cancelled = false;
    api(`/api/agents/${agentId}`)
      .then((data) => {
        if (!cancelled) setAgentName(String(data.agent?.name || "").trim());
      })
      .catch(() => {
        /* name is cosmetic */
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  if (!agentId) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6 text-sm text-teal-900/70">
        Missing agent.
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col gap-2 p-2 sm:p-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2 text-sm text-teal-950">
        <Link
          to={`/agents/${encodeURIComponent(agentId)}`}
          className="font-semibold text-teal-800 underline-offset-2 hover:underline"
        >
          ← Agent
        </Link>
        <span className="text-teal-900/50">·</span>
        <span className="font-semibold">{agentName || "Live view"}</span>
        <span className="text-teal-900/60">— zoom opens automatically when online</span>
      </div>
      <div className="min-h-0 flex-1">
        <LiveScreen
          agentId={agentId}
          agentName={agentName}
          fill
          autoZoom
          className="h-full min-h-[70dvh]"
        />
      </div>
    </div>
  );
}
