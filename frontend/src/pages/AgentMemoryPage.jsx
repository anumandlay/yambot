/**
 * @fileoverview Agent memory viewer — curated MEMORY, day history, notes, credentials.
 * Purpose: Inspect Hermes-style curated notes plus day logs and site logins.
 * Downstream: GET/POST `/api/agents/:id/memory`, curated-memory, credentials.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useMatch, useParams } from "react-router-dom";
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
 * @param {string} hay
 * @returns {boolean}
 */
function textMatches(q, hay) {
  const query = String(q || "").trim().toLowerCase();
  if (!query) return true;
  const h = String(hay || "").toLowerCase();
  return query
    .split(/\s+/)
    .filter(Boolean)
    .every((tok) => h.includes(tok));
}

/**
 * @param {string} q
 * @param {object} day
 * @returns {boolean}
 */
function dayMatches(q, day) {
  if (!String(q || "").trim()) return true;
  const hay = [
    day.day,
    day.summary,
    day.detail,
    ...(Array.isArray(day.keywords) ? day.keywords : []),
  ].join(" ");
  return textMatches(q, hay);
}

/**
 * @param {string} q
 * @param {object} cred
 * @returns {boolean}
 */
function credMatches(q, cred) {
  return textMatches(
    q,
    [cred.label, cred.siteHost, cred.username, cred.email, cred.notes].join(" ")
  );
}

/**
 * Day history + notes + user-managed credential vault for one agent.
 */
export function AgentMemoryPage() {
  const { agentId } = useParams();
  const fromHistory = Boolean(useMatch("/history/agents/:agentId/memory"));
  const [agentName, setAgentName] = useState("");
  const [memory, setMemory] = useState([]);
  const [dayLogs, setDayLogs] = useState([]);
  const [credentials, setCredentials] = useState([]);
  const [curatedEntries, setCuratedEntries] = useState([]);
  /** @type {[{ content: string, at: string|null }[], Function]} */
  const [curatedItems, setCuratedItems] = useState([]);
  const [curatedUsage, setCuratedUsage] = useState("");
  const [curatedUpdatedAt, setCuratedUpdatedAt] = useState(null);
  const [curatedDraft, setCuratedDraft] = useState("");
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState({});
  const [credForm, setCredForm] = useState(EMPTY_CRED);
  const [editingId, setEditingId] = useState("");
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState("");
  const [busy, setBusy] = useState(true);
  const [credBusy, setCredBusy] = useState(false);
  const [curatedBusy, setCuratedBusy] = useState(false);

  const load = useCallback(async () => {
    if (!agentId) return;
    setBusy(true);
    try {
      const data = await api(`/api/agents/${agentId}/memory`);
      setAgentName(data.agent?.name || "Agent");
      setMemory(data.memory || []);
      setDayLogs(data.dayLogs || []);
      setCredentials(data.credentials || []);
      const items = Array.isArray(data.curatedMemory?.items)
        ? data.curatedMemory.items
        : (data.curatedMemory?.entries || []).map((content) => ({
            content: String(content),
            at: null,
          }));
      setCuratedItems(items);
      setCuratedEntries(items.map((i) => i.content));
      setCuratedUsage(data.curatedMemory?.usage || "");
      setCuratedUpdatedAt(data.curatedMemory?.updatedAt || null);
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

  // Why: History "Curated memory" links with #curated; section mounts after load finishes.
  useEffect(() => {
    if (busy) return;
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#curated") return;
    const el = document.getElementById("curated");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [busy]);

  const filteredDays = useMemo(
    () => dayLogs.filter((d) => dayMatches(filter, d)),
    [dayLogs, filter]
  );
  const filteredCurated = useMemo(
    () => curatedItems.filter((item) => textMatches(filter, item.content)),
    [curatedItems, filter]
  );
  const filteredCreds = useMemo(
    () => credentials.filter((c) => credMatches(filter, c)),
    [credentials, filter]
  );
  const filteredNotes = useMemo(
    () =>
      memory.filter(
        (m) =>
          textMatches(filter, m.content) ||
          textMatches(filter, KIND_LABEL[m.kind] || m.kind || "")
      ),
    [memory, filter]
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
        "Clear day history and episodic notes? Curated MEMORY and saved logins will be kept."
      )
    ) {
      return;
    }
    try {
      await api(`/api/agents/${agentId}/memory`, { method: "DELETE" });
      setMemory([]);
      setDayLogs([]);
      setOkMsg("History cleared. Curated MEMORY and credentials kept.");
    } catch (err) {
      setError(err);
    }
  }

  /**
   * @param {import("react").FormEvent} e
   */
  async function onAddCurated(e) {
    e.preventDefault();
    if (!agentId || !curatedDraft.trim()) return;
    setCuratedBusy(true);
    setOkMsg("");
    try {
      const data = await api(`/api/agents/${agentId}/curated-memory`, {
        method: "POST",
        body: JSON.stringify({ action: "add", content: curatedDraft.trim() }),
      });
      setCuratedEntries(data.entries || []);
      setCuratedItems(
        Array.isArray(data.items)
          ? data.items
          : (data.entries || []).map((content) => ({ content: String(content), at: null }))
      );
      setCuratedUsage(data.usage || "");
      setCuratedUpdatedAt(data.updatedAt || new Date().toISOString());
      setCuratedDraft("");
      setOkMsg(data.message || "Curated memory entry added.");
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setCuratedBusy(false);
    }
  }

  /**
   * @param {string} entry
   */
  async function onRemoveCurated(entry) {
    if (!agentId || !window.confirm("Remove this curated MEMORY entry?")) return;
    setCuratedBusy(true);
    try {
      const data = await api(`/api/agents/${agentId}/curated-memory`, {
        method: "POST",
        body: JSON.stringify({ action: "remove", oldText: entry.slice(0, 80) }),
      });
      setCuratedEntries(data.entries || []);
      setCuratedItems(
        Array.isArray(data.items)
          ? data.items
          : (data.entries || []).map((content) => ({ content: String(content), at: null }))
      );
      setCuratedUsage(data.usage || "");
      setCuratedUpdatedAt(data.updatedAt || new Date().toISOString());
      setOkMsg(data.message || "Entry removed.");
    } catch (err) {
      setError(err);
    } finally {
      setCuratedBusy(false);
    }
  }

  async function clearCurated() {
    if (!agentId || !window.confirm("Clear this agent's curated MEMORY store?")) return;
    setCuratedBusy(true);
    try {
      await api(`/api/agents/${agentId}/curated-memory`, { method: "DELETE" });
      setCuratedEntries([]);
      setCuratedItems([]);
      setCuratedUsage("0% — 0/20,000 chars");
      setCuratedUpdatedAt(new Date().toISOString());
      setOkMsg("Curated MEMORY cleared.");
    } catch (err) {
      setError(err);
    } finally {
      setCuratedBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to={fromHistory ? "/history" : "/agents"}
          className="inline-flex min-h-11 items-center rounded-xl border border-teal-100 bg-white px-3 text-sm font-semibold"
        >
          {fromHistory ? "← History" : "← Agents"}
        </Link>
        {agentId && !fromHistory ? (
          <Link
            to={`/agents/${agentId}`}
            className="inline-flex min-h-11 items-center rounded-xl border border-teal-100 bg-white px-3 text-sm font-semibold"
          >
            Edit agent
          </Link>
        ) : null}
        {agentId && fromHistory ? (
          <Link
            to={`/history/agents/${agentId}`}
            className="inline-flex min-h-11 items-center rounded-xl border border-teal-100 bg-white px-3 text-sm font-semibold"
          >
            Chat history
          </Link>
        ) : null}
        <Link
          to="/settings/memory"
          className="inline-flex min-h-11 items-center rounded-xl border border-teal-100 bg-white px-3 text-sm font-semibold"
        >
          Account USER memory
        </Link>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
          Memory{agentName ? ` — ${agentName}` : ""}
        </h1>
      </div>

      <p className="text-sm text-teal-900/70">
        Curated MEMORY (durable facts, 20,000 char cap). Each run injects the top facts
        relevant to that goal (semantic when your LLM supports embeddings). Day history and
        episodic notes stay separate. Account USER prefs live under Settings → Memory.
      </p>

      {!busy ? (
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search memory by keyword…"
          className="min-h-11 w-full rounded-xl border border-teal-200 bg-white px-3 text-sm"
          aria-label="Search agent memory"
        />
      ) : null}

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
          <section
            id="curated"
            className="scroll-mt-4 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm"
          >
            <SectionTitle className="mb-2">Curated MEMORY</SectionTitle>
            <p className="mb-2 text-xs text-teal-900/65">
              Agent notes / env lessons. Agents can also write via the memory tool. Usage:{" "}
              {curatedUsage || "—"}
              {curatedUpdatedAt ? ` · last changed ${fmtWhen(curatedUpdatedAt)}` : ""}
            </p>
            <ul className="mb-3 space-y-2">
              {filteredCurated.length === 0 ? (
                <li className="text-sm text-teal-900/60">
                  {curatedItems.length === 0
                    ? "No curated entries yet."
                    : "No curated entries match this search."}
                </li>
              ) : (
                filteredCurated.map((item) => (
                  <li
                    key={`${item.content.slice(0, 48)}-${item.at || "legacy"}`}
                    className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-teal-50 bg-teal-50/40 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      {item.at ? (
                        <div className="text-[0.7rem] font-semibold text-teal-800/60">
                          Added {fmtWhen(item.at)}
                        </div>
                      ) : (
                        <div className="text-[0.7rem] font-semibold text-teal-800/45">
                          Added (before timestamps)
                        </div>
                      )}
                      <span className="mt-0.5 block whitespace-pre-wrap text-teal-950">
                        {item.content}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={curatedBusy}
                      onClick={() => onRemoveCurated(item.content)}
                      className="min-h-9 shrink-0 rounded-lg border border-rose-200 bg-white px-2 text-xs font-semibold text-rose-800"
                    >
                      Remove
                    </button>
                  </li>
                ))
              )}
            </ul>
            <form onSubmit={onAddCurated} className="flex flex-col gap-2">
              <FieldLabel htmlFor="curated-draft">Add curated entry</FieldLabel>
              <textarea
                id="curated-draft"
                value={curatedDraft}
                onChange={(e) => setCuratedDraft(e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-teal-100 bg-white px-3 py-2 text-sm"
                placeholder="e.g. Prefer Playwright over Selenium for this site"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={curatedBusy || !curatedDraft.trim()}
                  className="min-h-10 rounded-xl bg-teal-700 px-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Add
                </button>
                <button
                  type="button"
                  disabled={curatedBusy || curatedEntries.length === 0}
                  onClick={clearCurated}
                  className="min-h-10 rounded-xl border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-800 disabled:opacity-50"
                >
                  Clear curated
                </button>
              </div>
            </form>
          </section>

          <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
            <SectionTitle helpId="agent.memory.credentials" className="mb-2">
              Saved logins
            </SectionTitle>
            <p className="mb-3 text-xs text-teal-900/65">
              You enter these; the agent may reuse them when the site matches. It cannot invent or
              store new passwords.
            </p>
            <ul className="mb-4 space-y-2">
              {filteredCreds.length === 0 ? (
                <li className="text-sm text-teal-900/60">
                  {credentials.length === 0
                    ? "No logins saved yet."
                    : "No logins match this search."}
                </li>
              ) : (
                filteredCreds.map((c) => (
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
                    {c.at ? (
                      <div className="mt-0.5 text-[0.7rem] text-teal-800/55">
                        Saved {fmtWhen(c.at)}
                      </div>
                    ) : null}
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
            <p className="mb-3 text-xs text-teal-900/55">
              Filtered by the search box above when you type a keyword.
            </p>
            {filteredDays.length === 0 ? (
              <p className="text-sm text-teal-900/60">
                {dayLogs.length === 0
                  ? "No day history yet — it fills in when runs complete."
                  : "No days match this search."}
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
                          <div className="flex flex-wrap items-baseline gap-2">
                            <div className="text-sm font-bold text-teal-950">{d.day}</div>
                            {d.at ? (
                              <span className="text-[0.7rem] text-teal-800/55">
                                updated {fmtWhen(d.at)}
                              </span>
                            ) : null}
                          </div>
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
            {filteredNotes.length === 0 ? (
              <p className="text-sm text-teal-900/60">
                {memory.length === 0
                  ? "No short notes yet."
                  : "No short notes match this search."}
              </p>
            ) : (
              <ul className="space-y-2">
                {filteredNotes.map((m) => (
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
