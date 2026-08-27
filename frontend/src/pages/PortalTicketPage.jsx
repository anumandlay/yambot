/**
 * @fileoverview Public customer portal — ticket status by token (no auth).
 * Purpose: External-facing support status page.
 * Downstream: GET /api/portal/ticket/:token.
 */

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:4000").replace(/\/$/, "");

export function PortalTicketPage() {
  const { token } = useParams();
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/portal/ticket/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) setError(data.detail || "Not found");
        else setTicket(data.ticket);
      })
      .catch(() => setError("Unable to load ticket"));
  }, [token]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-center text-lg font-bold text-teal-900">Support request</h1>
      {error ? (
        <p className="text-center text-sm text-red-700">{error}</p>
      ) : ticket ? (
        <div className="rounded-2xl border border-teal-100 bg-white p-6 shadow-sm">
          <div className="font-semibold">{ticket.title}</div>
          <div className="mt-2 text-sm capitalize text-teal-900/80">Status: {ticket.status.replace(/_/g, " ")}</div>
          <div className="mt-1 text-xs text-teal-900/60">
            Updated {ticket.updatedAt ? new Date(ticket.updatedAt).toLocaleString() : "—"}
          </div>
        </div>
      ) : (
        <p className="text-center text-sm text-teal-900/60">Loading…</p>
      )}
    </div>
  );
}
