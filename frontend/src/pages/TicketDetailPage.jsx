/**
 * @fileoverview Ticket detail — email thread, process, portal link, documents.
 * Purpose: Full ticket view beyond queue list.
 * Downstream: GET /api/tickets/:id.
 */

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";

export function TicketDetailPage() {
  const { ticketId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api(`/api/tickets/${ticketId}`)
      .then(setData)
      .catch((err) => setError(err));
  }, [ticketId]);

  if (error) {
    return (
      <div className="p-4">
        <ErrorAlert title={error.title} detail={error.detail || error.message} onClose={() => setError(null)} />
      </div>
    );
  }
  if (!data?.ticket) {
    return <p className="p-4 text-sm text-teal-900/60">Loading…</p>;
  }

  const t = data.ticket;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <Link to="/queues" className="text-sm font-semibold text-teal-800 underline">
        ← Queues
      </Link>
      <div>
        <h1 className="text-xl font-bold">{t.title}</h1>
        <p className="text-sm text-teal-900/70">
          {t.status} · {t.priority}
          {t.assigneeAgent?.name ? ` · ${t.assigneeAgent.name}` : ""}
        </p>
        {data.portalUrl ? (
          <p className="mt-1 text-xs text-violet-800">
            Customer portal:{" "}
            <a href={data.portalUrl} className="underline" target="_blank" rel="noreferrer">
              {window.location.origin}
              {data.portalUrl}
            </a>
          </p>
        ) : null}
        {t.slaDueAt ? (
          <p className="text-xs text-amber-800">SLA due: {new Date(t.slaDueAt).toLocaleString()}</p>
        ) : null}
      </div>
      <div className="rounded-xl border border-teal-100 bg-white p-4 text-sm whitespace-pre-wrap">{t.description}</div>
      {data.processInstance ? (
        <div className="rounded-xl border border-violet-100 bg-violet-50/30 p-3 text-sm">
          <h2 className="font-bold">Process</h2>
          <p>
            {data.processInstance.definition?.name} · stage {data.processInstance.currentStage} (
            {data.processInstance.status})
          </p>
        </div>
      ) : null}
      {data.emails?.length ? (
        <div className="rounded-xl border border-teal-100 bg-white p-4">
          <h2 className="text-sm font-bold">Email thread</h2>
          <ul className="mt-2 flex flex-col gap-2 text-xs">
            {data.emails.map((m) => (
              <li key={m._id} className="rounded-lg bg-teal-50/50 p-2">
                <div className="font-semibold">
                  {m.direction === "outbound" ? "→" : "←"} {m.subject}
                </div>
                <div className="text-teal-900/60">
                  {m.from} · {m.createdAt ? new Date(m.createdAt).toLocaleString() : ""}
                </div>
                <p className="mt-1 line-clamp-4">{m.text}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {data.documents?.length ? (
        <div className="text-sm">
          <h2 className="font-bold">Attachments</h2>
          <ul className="mt-1 list-disc pl-5">
            {data.documents.map((d) => (
              <li key={d._id}>{d.filename}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
