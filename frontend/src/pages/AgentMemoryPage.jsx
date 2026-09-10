/**
 * @fileoverview Agent memory viewer — day history, notes, and credential vault.
 * Purpose: Inspect what the agent did (by day) and manage site logins it may reuse.
 * Downstream: GET/POST/PATCH/DELETE `/api/agents/:id/memory` and `/credentials`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { FieldLabel, SectionTitle } from "../components/FieldLabel.jsx";

const KIND_LABEL = {
  note: "Note",
  run: "From a run",
  avoid: "Avoid",
  preference: "Preference",
};

const EMPTY_CRED = {
  label: "",
  siteHost: "",
  username: "",
  email: "",
  password: "",
  notes: "",
};

/**
 * @param {string|Date|null|undefined} d
 * @returns {string}
 */
function fmtWhen(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString();
  } catch {
    return "—";
  }
}

/**
 * @param {string} q
 * @param {object} day
 * @returns {boolean}
 */
function dayMatches(q, day) {
  if (!q) return true;
  const hay = [
    day.day,
    day.summary,
    day.detail,
    ...(Array.isArray(day.keywords) ? day.keywords : []),
  ]
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((tok) => hay.includes(tok));
}

/**
 * Day history + notes + user-managed credential vault for one agent.
 */
export function AgentMemoryPage() {
  const { agentId } = useParams();
  const [agentName, setAgentName] = useState("");
  const [memory, setMemory] = useState([]);
  const [dayLogs, setDayLogs] = useState([]);
  const [credentials, setCredentials] = useState([]);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState({});
  const [credForm, setCredForm] = useState(EMPTY_CRED);
  const [editingId, setEditingId] = useState("");
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState("");
  const [busy, setBusy] = useState(true);
  const [credBusy, setCredBusy] = useState(false);

  const load = useCallback(async () => {
    if (!agentId) return;
    setBusy(true);
    try {
      const data = await api(`/api/agents/${agentId}/memory`);
      setAgentName(data.agent?.name || "Agent");
      setMemory(data.memory || []);
      setDayLogs(data.dayLogs || []);
      setCredentials(data.credentials || []);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [agentId]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredDays = useMemo(
    () => dayLogs.filter((d) => dayMatches(filter, d)),
    [dayLogs, filter]
  );

  /**
   * @param {import("react").FormEvent} e
   */
  async function onSaveCredential(e) {
    e.preventDefault();
    if (!agentId) return;
    setCredBusy(true);
    setError(null);
    setOkMsg("");
    try {
      const body = {
        label: credForm.label,
        siteHost: credForm.siteHost,
        username: credForm.username,
        email: credForm.email,
        notes: credForm.notes,
      };
      if (credForm.password) body.password = credForm.password;
      let data;
      if (editingId) {
        data = await api(`/api/agents/${agentId}/credentials/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        data = await api(`/api/agents/${agentId}/credentials`, {
          method: "POST",
          body: JSON.stringify({ ...body, password: credForm.password }),
        });
      }
      setCredentials(data.credentials || []);
      setCredForm(EMPTY_CRED);
      setEditingId("");
      setOkMsg(editingId ? "Login updated." : "Login saved for this agent.");
    } catch (err) {
      setError(err);
    } finally {
      setCredBusy(false);
    }
  }

  /**
   * @param {object} c
   */
  function startEdit(c) {
    setEditingId(c.id);
    setCredForm({
      label: c.label || "",
      siteHost: c.siteHost || "",
      username: c.username || "",
      email: c.email || "",
      password: c.password || "",
      notes: c.notes || "",
    });
  }

  /**
   * @param {string} id
   */
  async function removeCredential(id) {
    if (!agentId || !window.confirm("Delete this saved login?")) return;
    setCredBusy(true);
    try {
      const data = await api(`/api/agents/${agentId}/credentials/${id}`, {
        method: "DELETE",
      });
      setCredentials(data.credentials || []);
      if (editingId === id) {
        setEditingId("");
        setCredForm(EMPTY_CRED);
      }
      setOkMsg("Login deleted.");
    } catch (err) {
      setError(err);
    } finally {
      setCredBusy(false);
    }
  }

  async function clearHistory() {
    if (
      !agentId ||
      !window.confirm(
        "Clear day history and memory notes? Saved logins will be kept."
      )
    ) {
      return;
    }
    try {
      await api(`/api/agents/${agentId}/memory`, { method: "DELETE" });
      setMemory([]);
      setDayLogs([]);
      setOkMsg("History cleared. Credentials kept.");
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/agents"
          className="inline-flex min-h-11 items-center rounded-xl border border-teal-100 bg-white px-3 text-sm font-semibold"
        >
          ← Agents
        </Link>
        {agentId ? (
          <Link
            to={`/agents/${agentId}`}
            className="inline-flex min-h-11 items-center rounded-xl border border-teal-100 bg-white px-3 text-sm font-semibold"
          >
            Edit agent
          </Link>
        ) : null}
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
          Memory{agentName ? ` — ${agentName}` : ""}
        </h1>
      </div>

      <p className="text-sm text-teal-900/70">
        Day-by-day history of what this agent did, plus logins you save for it to reuse. New chats
        always get recent day summaries; matching keywords pull fuller detail into the run.
      </p>

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}
      {okMsg ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
          {okMsg}
        </p>
      ) : null}

      {busy ? (
        <p className="text-sm text-teal-900/70">Loading memory…</p>
      ) : (
        <>
          <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
            <SectionTitle helpId="agent.memory.credentials" className="mb-2">
              Saved logins
            </SectionTitle>
            <p className="mb-3 text-xs text-teal-900/65">
              You enter these; the agent may reuse them when the site matches. It cannot invent or
              store new passwords.
            </p>
            <ul className="mb-4 space-y-2">
              {credentials.length === 0 ? (
                <li className="text-sm text-teal-900/60">No logins saved yet.</li>
              ) : (
                credentials.map((c) => (
                  <li
                    key={c.id || `${c.label}-${c.siteHost}`}
                    className="rounded-xl border border-teal-50 bg-teal-50/40 px-3 py-2 text-sm"
                  >
                    <div className="font-semibold text-teal-950">
                      {c.label || c.siteHost || "Login"}
                      {c.siteHost ? (
                        <span className="ml-2 font-normal text-teal-800/70">{c.siteHost}</span>
                      ) : null}
                    </div>
                    <div className="mt-1 space-y-0.5 font-mono text-xs text-teal-900/85">
                      {c.username ? <div>username: {c.username}</div> : null}
                      {c.email ? <div>email: {c.email}</div> : null}
                      <div>password: {c.password || "(empty)"}</div>
                      {c.notes ? <div className="font-sans">notes: {c.notes}</div> : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="min-h-11 rounded-xl border border-teal-200 px-3 text-xs font-semibold"
                        onClick={() => startEdit(c)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="min-h-11 rounded-xl border border-rose-200 px-3 text-xs font-semibold text-rose-800"
                        onClick={() => void removeCredential(c.id)}
                        disabled={credBusy}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))
              )}
            </ul>
            <form onSubmit={onSaveCredential} className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <FieldLabel helpId="agent.memory.credLabel">Label</FieldLabel>
                <input
                  className="min-h-11 rounded-xl border border-teal-100 px-3"
                  value={credForm.label}
                  onChange={(e) => setCredForm((p) => ({ ...p, label: e.target.value }))}
                  placeholder="e.g. Gmail work"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <FieldLabel helpId="agent.memory.credSite">Site host</FieldLabel>
                <input
                  className="min-h-11 rounded-xl border border-teal-100 px-3"
                  value={credForm.siteHost}
                  onChange={(e) => setCredForm((p) => ({ ...p, siteHost: e.target.value }))}
                  placeholder="mail.google.com"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <FieldLabel helpId="agent.memory.credUser">Username</FieldLabel>
                <input
                  className="min-h-11 rounded-xl border border-teal-100 px-3"
                  value={credForm.username}
                  onChange={(e) => setCredForm((p) => ({ ...p, username: e.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <FieldLabel helpId="agent.memory.credEmail">Email</FieldLabel>
                <input
                  className="min-h-11 rounded-xl border border-teal-100 px-3"
                  value={credForm.email}
                  onChange={(e) => setCredForm((p) => ({ ...p, email: e.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <FieldLabel helpId="agent.memory.credPassword">Password</FieldLabel>
                <input
                  className="min-h-11 rounded-xl border border-teal-100 px-3 font-mono"
                  value={credForm.password}
                  onChange={(e) => setCredForm((p) => ({ ...p, password: e.target.value }))}
                  placeholder={editingId ? "Leave blank to keep current" : ""}
                  autoComplete="off"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <FieldLabel helpId="agent.memory.credNotes">Notes</FieldLabel>
                <input
                  className="min-h-11 rounded-xl border border-teal-100 px-3"
                  value={credForm.notes}
                  onChange={(e) => setCredForm((p) => ({ ...p, notes: e.target.value }))}
                />
              </label>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <button
                  type="submit"
                  disabled={credBusy}
                  className="min-h-11 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {credBusy ? "Saving…" : editingId ? "Update login" : "Add login"}
                </button>
                {editingId ? (
                  <button
                    type="button"
                    className="min-h-11 rounded-xl border border-teal-200 px-4 text-sm font-semibold"
                    onClick={() => {
                      setEditingId("");
                      setCredForm(EMPTY_CRED);
                    }}
                  >
                    Cancel edit
                  </button>
                ) : null}
              </div>
            </form>
          </section>

          <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <SectionTitle helpId="agent.memory.dayHistory">Day history</SectionTitle>
              <button
                type="button"
                onClick={() => void clearHistory()}
                className="min-h-11 rounded-xl border border-rose-200 px-3 text-xs font-semibold text-rose-800"
              >
                Clear history
              </button>
            </div>
            <label className="mb-3 flex flex-col gap-1 text-sm">
              <FieldLabel helpId="agent.memory.filter">Filter by keywords</FieldLabel>
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="e.g. travel gmail india"
              />
            </label>
            {filteredDays.length === 0 ? (
              <p className="text-sm text-teal-900/60">
                {dayLogs.length === 0
                  ? "No day history yet — it fills in when runs complete."
                  : "No days match this filter."}
              </p>
            ) : (
              <ul className="space-y-3">
                {filteredDays.map((d) => {
                  const key = d.id || d.day;
                  const open = Boolean(expanded[key]);
                  return (
                    <li key={key} className="rounded-xl border border-teal-50 bg-teal-50/30 px-3 py-2">
                      <button
                        type="button"
                        className="flex w-full min-h-11 items-start justify-between gap-2 text-left"
                        onClick={() =>
                          setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
                        }
                      >
                        <div>
                          <div className="text-sm font-bold text-teal-950">{d.day}</div>
                          <div className="mt-1 whitespace-pre-wrap text-sm text-teal-900/85">
                            {d.summary || "(no summary)"}
                          </div>
                          {d.keywords?.length ? (
                            <div className="mt-1 text-xs text-teal-800/60">
                              {d.keywords.slice(0, 12).join(" · ")}
                            </div>
                          ) : null}
                        </div>
                        <span className="shrink-0 text-xs font-semibold text-teal-700">
                          {open ? "Hide" : "Detail"}
                        </span>
                      </button>
                      {open && d.detail ? (
                        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-white/80 p-2 text-xs text-teal-950">
                          {d.detail}
                        </pre>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
            <SectionTitle helpId="agent.memory.notes" className="mb-2">
              Short notes
            </SectionTitle>
            {memory.length === 0 ? (
              <p className="text-sm text-teal-900/60">No short notes yet.</p>
            ) : (
              <ul className="space-y-2">
                {memory.map((m) => (
                  <li
                    key={m.id || `${m.at}-${m.content?.slice(0, 24)}`}
                    className="rounded-xl border border-teal-50 bg-white px-3 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs text-teal-800/70">
                      <span className="font-semibold">{KIND_LABEL[m.kind] || m.kind}</span>
                      <span>{fmtWhen(m.at)}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-teal-950">{m.content}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
