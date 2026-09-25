/**
 * @fileoverview Agent memory viewer — curated MEMORY, Mem0 facts, day history, notes, credentials.
 * Purpose: Inspect Mongo curated notes plus Mem0/Qdrant agent facts from chat “remember”.
 * UI: curated + Mem0 as one text block each; Day history + Short notes sit in a 2-box grid
 * with internal scroll so the page stays short.
 * Downstream: GET/POST `/api/agents/:id/memory`, curated-memory, curated-memory/mem0, credentials.
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
  const [mem0Items, setMem0Items] = useState([]);
  const [mem0Enabled, setMem0Enabled] = useState(false);
  // Why: default open so “empty” is obvious (BMW lived in chat, not Mem0).
  const [mem0Open, setMem0Open] = useState(true);
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
      setMem0Enabled(Boolean(data.mem0Enabled));
      setMem0Items(Array.isArray(data.mem0Items) ? data.mem0Items : []);
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

  // Why: History links use #curated / #mem0; section mounts after load finishes.
  useEffect(() => {
    if (busy) return;
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (hash === "#mem0") {
      setMem0Open(true);
      const el = document.getElementById("mem0");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (hash !== "#curated") return;
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
  /** One readable block for the curated section (no per-entry chips). */
  const curatedBlockText = useMemo(
    () =>
      filteredCurated
        .map((item) => String(item?.content || "").trim())
        .filter(Boolean)
        .join("\n\n"),
    [filteredCurated]
  );
  const filteredMem0 = useMemo(
    () => mem0Items.filter((item) => textMatches(filter, item.content)),
    [mem0Items, filter]
  );
  /** One block for Mem0 agent facts (no per-fact chips). */
  const mem0BlockText = useMemo(
    () =>
      filteredMem0
        .map((item) => String(item?.content || "").trim())
        .filter(Boolean)
        .join("\n\n"),
    [filteredMem0]
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

  async function onClearMem0() {
    if (
      !agentId ||
      !window.confirm("Clear all Mem0 facts for this agent? Mongo curated MEMORY is kept.")
    ) {
      return;
    }
    setCuratedBusy(true);
    setError(null);
    setOkMsg("");
    try {
      const data = await api(`/api/agents/${agentId}/curated-memory?mem0Only=1`, {
        method: "DELETE",
      });
      setMem0Items([]);
      setOkMsg(data.message || "Mem0 agent facts cleared.");
    } catch (err) {
      setError(err);
    } finally {
      setCuratedBusy(false);
    }
  }

  function openMem0Section() {
    setMem0Open(true);
    if (typeof window !== "undefined") {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}#mem0`
      );
    }
    requestAnimationFrame(() => {
      const el = document.getElementById("mem0");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
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
        Curated MEMORY (durable facts, 20,000 char cap). Chat “remember …” and Auto ingest also
        write Mem0 agent facts (separate store — use View Mem0 below). Day history and episodic
        notes stay separate. Account USER prefs live under Settings → Memory.
      </p>

      {!busy ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={openMem0Section}
            className="inline-flex min-h-11 items-center rounded-xl border border-amber-200 bg-amber-50 px-3 text-sm font-semibold text-amber-950"
          >
            View Mem0
            {mem0Enabled ? ` (${mem0Items.length})` : " (off)"}
          </button>
          <a
            href="#curated"
            className="inline-flex min-h-11 items-center rounded-xl border border-teal-100 bg-white px-3 text-sm font-semibold text-teal-900"
          >
            Jump to curated
          </a>
        </div>
      ) : null}

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
              {filteredCurated.length > 0
                ? ` · ${filteredCurated.length} entr${filteredCurated.length === 1 ? "y" : "ies"} shown as one block`
                : ""}
            </p>
            {filteredCurated.length === 0 ? (
              <p className="mb-3 text-sm text-teal-900/60">
                {curatedItems.length === 0
                  ? "No curated entries yet."
                  : "No curated entries match this search."}
              </p>
            ) : (
              <pre className="mb-3 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-xl border border-teal-100 bg-teal-50/40 px-3 py-3 text-sm leading-relaxed text-teal-950">
                {curatedBlockText}
              </pre>
            )}
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

          <section
            id="mem0"
            className="scroll-mt-4 rounded-2xl border border-amber-100 bg-amber-50/40 p-4 shadow-sm"
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <SectionTitle className="mb-0">
                Mem0 agent facts
                {mem0Enabled ? ` (${mem0Items.length})` : " (off)"}
              </SectionTitle>
              <button
                type="button"
                onClick={() => setMem0Open((o) => !o)}
                className="min-h-9 rounded-lg border border-amber-200 bg-white px-3 text-xs font-semibold text-amber-950"
              >
                {mem0Open ? "Hide" : "Show"}
              </button>
            </div>
            <p className="mb-3 text-xs text-teal-800/80">
              Semantic store for this agent (chat “remember …” now writes here). Not the same as
              Mongo curated MEMORY above. Account-wide Mem0 USER prefs: Settings → Memory. If this
              list is empty but chat still “knows” a fact, it is only in the chat transcript.
            </p>
            {!mem0Open ? (
              <p className="text-sm text-teal-900/60">
                Hidden — click Show or View Mem0 to list facts
                {mem0Enabled && mem0Items.length ? ` (${mem0Items.length} stored)` : ""}.
              </p>
            ) : !mem0Enabled ? (
              <p className="text-sm text-teal-900/60">Mem0 is disabled on this server.</p>
            ) : (
              <>
                {filteredMem0.length === 0 ? (
                  <p className="mb-3 text-sm text-teal-900/60">
                    {mem0Items.length === 0
                      ? "No Mem0 agent facts yet — say “remember …” in chat to save one, or check Settings → Memory for USER prefs."
                      : "No Mem0 facts match this search."}
                  </p>
                ) : (
                  <pre className="mb-3 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-xl border border-amber-100 bg-white px-3 py-3 text-sm leading-relaxed text-teal-950">
                    {mem0BlockText}
                  </pre>
                )}
                <button
                  type="button"
                  disabled={curatedBusy || mem0Items.length === 0}
                  onClick={() => void onClearMem0()}
                  className="min-h-10 rounded-xl border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-800 disabled:opacity-50"
                >
                  Clear Mem0 agent facts
                </button>
              </>
            )}
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

          <div className="grid gap-4 md:grid-cols-2 md:items-stretch">
            <section className="flex min-h-0 flex-col rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <SectionTitle helpId="agent.memory.dayHistory">Day history</SectionTitle>
                <button
                  type="button"
                  onClick={() => void clearHistory()}
                  className="min-h-11 rounded-xl border border-rose-200 px-3 text-xs font-semibold text-rose-800"
                >
                  Clear history
                </button>
              </div>
              <p className="mb-2 text-xs text-teal-900/55">
                Daily run rollups. Scroll inside this box — search above filters both panels.
              </p>
              <div className="min-h-[14rem] max-h-[22rem] flex-1 overflow-y-auto overscroll-contain pr-1">
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
                            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-white/80 p-2 text-xs text-teal-950">
                              {d.detail}
                            </pre>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>

            <section className="flex min-h-0 flex-col rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
              <SectionTitle helpId="agent.memory.notes" className="mb-2">
                Short notes
              </SectionTitle>
              <p className="mb-2 text-xs text-teal-900/55">
                Per-run receipts (“From a run”) and other notes. Scroll inside this box.
              </p>
              <div className="min-h-[14rem] max-h-[22rem] flex-1 overflow-y-auto overscroll-contain pr-1">
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
                        className="rounded-xl border border-teal-50 bg-teal-50/20 px-3 py-2 text-sm"
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
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
