/**
 * @fileoverview Queues page — tickets, campaign pipeline, agent task queue, documents.
 * Purpose: Dedicated operational views for support, outreach, and work in progress.
 * Downstream: /api/queues/*, /api/tickets, /api/documents.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, getToken } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { ButtonWithHelp, FieldLabel, PageGuideBanner } from "../components/FieldLabel.jsx";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:4000").replace(/\/$/, "");

export function QueuesPage() {
  const [tab, setTab] = useState("tickets");
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState("");

  const [tickets, setTickets] = useState([]);
  const [ticketStats, setTicketStats] = useState([]);
  const [agents, setAgents] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [pipeline, setPipeline] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [documents, setDocuments] = useState([]);

  const [newTicketTitle, setNewTicketTitle] = useState("");
  const [newTicketDesc, setNewTicketDesc] = useState("");
  const [ticketFilter, setTicketFilter] = useState("open");

  const [docFile, setDocFile] = useState(null);
  const [docEntityId, setDocEntityId] = useState("");

  const load = useCallback(async () => {
    const [ticketData, stats, agentData, campData, taskData, docData] = await Promise.all([
      api(`/api/tickets?status=${ticketFilter === "all" ? "" : ticketFilter}&limit=100`).catch(() => ({
        tickets: [],
      })),
      api("/api/tickets/stats").catch(() => ({ byStatus: [] })),
      api("/api/agents"),
      api("/api/queues/campaigns").catch(() => ({ campaigns: [], pipeline: [] })),
      api("/api/queues/tasks").catch(() => ({ tasks: [] })),
      api("/api/documents").catch(() => ({ documents: [] })),
    ]);
    setTickets(ticketData.tickets || []);
    setTicketStats(stats.byStatus || []);
    setAgents(agentData.agents || []);
    setCampaigns(campData.campaigns || []);
    setPipeline(campData.pipeline || []);
    setTasks(taskData.tasks || []);
    setDocuments(docData.documents || []);
  }, [ticketFilter]);

  useEffect(() => {
    load().catch((err) => setError(err));
  }, [load]);

  async function createTicket(e) {
    e.preventDefault();
    setError(null);
    try {
      await api("/api/tickets", {
        method: "POST",
        body: JSON.stringify({
          title: newTicketTitle.trim(),
          description: newTicketDesc.trim(),
          priority: "normal",
        }),
      });
      setNewTicketTitle("");
      setNewTicketDesc("");
      setOkMsg("Ticket created.");
      await load();
    } catch (err) {
      setError(err);
    }
  }

  /**
   * @param {string} id
   * @param {string} status
   */
  async function updateTicketStatus(id, status) {
    setError(null);
    try {
      await api(`/api/tickets/${id}`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  /**
   * @param {string} id
   * @param {string} agentId
   */
  async function assignTicket(id, agentId) {
    setError(null);
    try {
      await api(`/api/tickets/${id}/assign`, {
        method: "POST",
        body: JSON.stringify({ agentId }),
      });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function uploadDocument(e) {
    e.preventDefault();
    if (!docFile) return;
    setError(null);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const dataUrl = String(reader.result || "");
        const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
        await api("/api/documents", {
          method: "POST",
          body: JSON.stringify({
            filename: docFile.name,
            mimeType: docFile.type || "application/octet-stream",
            dataBase64: base64,
            entityId: docEntityId.trim() || undefined,
          }),
          timeoutMs: 120000,
        });
        setDocFile(null);
        setOkMsg("Document uploaded.");
        await load();
      } catch (err) {
        setError(err);
      }
    };
    reader.readAsDataURL(docFile);
  }

  /**
   * @param {string} id
   * @param {string} filename
   */
  async function downloadDocument(id, filename) {
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/documents/${id}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const tabs = [
    ["tickets", "Tickets"],
    ["campaigns", "Campaign pipeline"],
    ["tasks", "Agent queue"],
    ["documents", "Documents"],
  ];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Queues</h1>
        <p className="text-sm text-teal-900/70">
          Support tickets, outreach pipeline, agent workload, and document attachments.
        </p>
      </div>

      <PageGuideBanner helpId="queues.page" />

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}
      {okMsg ? <p className="text-sm font-semibold text-teal-800">{okMsg}</p> : null}

      <div className="flex flex-wrap gap-2">
        {tabs.map(([id, label]) => (
          <ButtonWithHelp key={id} helpId={`queues.${id}`}>
            <button
              type="button"
              onClick={() => setTab(id)}
              className={`min-h-10 rounded-xl px-3 text-sm font-semibold ${
                tab === id ? "bg-teal-700 text-white" : "border border-teal-100 bg-white text-teal-900"
              }`}
            >
              {label}
            </button>
          </ButtonWithHelp>
        ))}
      </div>

      {tab === "tickets" ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2 text-xs">
            {ticketStats.map((s) => (
              <span key={s.status} className="rounded-lg bg-teal-50 px-2 py-1">
                {s.status}: {s.count}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {["open", "assigned", "in_progress", "waiting_customer", "resolved", "all"].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setTicketFilter(s)}
                className={`rounded-lg px-2 py-1 text-xs font-semibold ${
                  ticketFilter === s ? "bg-teal-700 text-white" : "border border-teal-100"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <form onSubmit={createTicket} className="flex flex-col gap-2 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
            <FieldLabel helpId="queues.ticketCreate">New ticket</FieldLabel>
            <input
              className="min-h-11 rounded-xl border border-teal-100 px-3 text-sm"
              placeholder="Subject"
              value={newTicketTitle}
              onChange={(e) => setNewTicketTitle(e.target.value)}
            />
            <textarea
              className="min-h-16 rounded-xl border border-teal-100 px-3 py-2 text-sm"
              placeholder="Description"
              value={newTicketDesc}
              onChange={(e) => setNewTicketDesc(e.target.value)}
            />
            <button type="submit" className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white">
              Create ticket
            </button>
          </form>
          <ul className="flex flex-col gap-2">
            {tickets.map((t) => (
              <li key={t._id} className="rounded-xl border border-teal-100 bg-white p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link to={`/tickets/${t._id}`} className="font-semibold text-teal-900 underline">
                      {t.title}
                    </Link>
                    <div className="text-xs text-teal-900/60">
                      {t.status} · {t.priority}
                      {t.requesterEntity?.name ? ` · ${t.requesterEntity.name}` : ""}
                      {t.source === "email" ? " · from email" : ""}
                    </div>
                  </div>
                  <select
                    className="rounded-lg border border-teal-100 px-2 py-1 text-xs"
                    value={t.assigneeAgent?._id || t.assigneeAgent || ""}
                    onChange={(e) => assignTicket(String(t._id), e.target.value)}
                  >
                    <option value="">Assign agent…</option>
                    {agents.map((a) => (
                      <option key={a._id} value={a._id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                {t.description ? (
                  <p className="mt-2 line-clamp-3 text-xs text-teal-900/70">{t.description}</p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {["in_progress", "waiting_customer", "resolved", "closed"].map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => updateTicketStatus(String(t._id), st)}
                      className="text-xs font-semibold text-teal-800 underline"
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "campaigns" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-teal-900/70">
            Active campaigns and enrollment stages. Manage campaigns on{" "}
            <Link to="/company" className="font-semibold text-teal-800 underline">
              Company → Campaigns
            </Link>
            .
          </p>
          <ul className="flex flex-col gap-2">
            {campaigns.map((c) => (
              <li key={c._id} className="rounded-xl border border-teal-100 bg-white p-3 text-sm">
                <div className="font-semibold">{c.name}</div>
                <div className="text-xs text-teal-900/60">
                  Enrolled {c.stats?.enrolled || 0} · Sent {c.stats?.sent || 0} · Replied{" "}
                  {c.stats?.replied || 0}
                </div>
              </li>
            ))}
          </ul>
          {pipeline.length ? (
            <div className="rounded-xl border border-violet-100 bg-violet-50/30 p-3">
              <h3 className="text-sm font-bold">Pipeline by stage</h3>
              <ul className="mt-2 flex flex-col gap-1 text-xs">
                {pipeline.map((row, i) => (
                  <li key={i}>
                    Campaign {String(row._id?.campaign || "").slice(-6)} · {row._id?.stage}: {row.count}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "tasks" ? (
        <ul className="flex flex-col gap-2">
          {tasks.length === 0 ? (
            <li className="rounded-xl border border-dashed border-teal-200 p-4 text-sm text-teal-900/60">
              No pending tasks — agents are idle or caught up.
            </li>
          ) : (
            tasks.map((t) => (
              <li key={t._id} className="rounded-xl border border-teal-100 bg-white p-3 text-sm">
                <div className="font-semibold">{t.agent?.name || "Agent"}</div>
                <div className="text-xs text-teal-900/60">
                  {t.status} · {t.priority} · {t.goal?.slice(0, 120) || "—"}
                </div>
                {t.chat ? (
                  <Link to={`/chats/${t.chat}`} className="mt-1 text-xs font-semibold text-teal-800 underline">
                    Open chat
                  </Link>
                ) : null}
              </li>
            ))
          )}
        </ul>
      ) : null}

      {tab === "documents" ? (
        <div className="flex flex-col gap-3">
          <form onSubmit={uploadDocument} className="flex flex-col gap-2 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
            <FieldLabel helpId="queues.documents">Upload document</FieldLabel>
            <p className="text-xs text-teal-900/60">Max 5 MB. Attach to an entity by ID (optional).</p>
            <input
              type="file"
              onChange={(e) => setDocFile(e.target.files?.[0] || null)}
              className="text-sm"
            />
            <input
              className="min-h-11 rounded-xl border border-teal-100 px-3 text-sm"
              placeholder="Entity ID (optional)"
              value={docEntityId}
              onChange={(e) => setDocEntityId(e.target.value)}
            />
            <button
              type="submit"
              disabled={!docFile}
              className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50"
            >
              Upload
            </button>
          </form>
          <ul className="flex flex-col gap-2">
            {documents.map((d) => (
              <li key={d._id} className="flex items-center justify-between rounded-xl border border-teal-100 bg-white p-3 text-sm">
                <div>
                  <div className="font-semibold">{d.filename}</div>
                  <div className="text-xs text-teal-900/60">
                    {(d.sizeBytes / 1024).toFixed(1)} KB · {d.mimeType}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => downloadDocument(String(d._id), d.filename)}
                  className="text-xs font-semibold text-teal-800 underline"
                >
                  Download
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
