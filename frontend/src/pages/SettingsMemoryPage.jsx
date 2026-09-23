/**
 * @fileoverview Account USER.md curated memory — Hermes-style prefs/identity.
 * Purpose: Display name + Mongo USER store + Mem0 USER-profile vectors (what the
 * Memory chip “USER prefs” section often shows when Mongo is empty).
 * Downstream: PUT `/api/auth/profile`; GET/POST/DELETE `/api/settings/curated-memory`.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { FieldLabel, SectionTitle } from "../components/FieldLabel.jsx";

/**
 * Settings tab for account name + curated USER memory (+ Mem0).
 */
export function SettingsMemoryPage() {
  const { user, refresh } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [items, setItems] = useState([]);
  const [mem0Items, setMem0Items] = useState([]);
  const [mem0Enabled, setMem0Enabled] = useState(false);
  const [usage, setUsage] = useState("");
  const [charCount, setCharCount] = useState(0);
  const [charLimit, setCharLimit] = useState(1375);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState("");
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    setDisplayName(String(user?.name || user?.displayName || "").trim());
  }, [user?.name, user?.displayName]);

  /**
   * @param {object} data
   */
  function applyStore(data) {
    const nextItems = Array.isArray(data.items)
      ? data.items
      : (data.entries || []).map((content) => ({ content: String(content), at: null }));
    setItems(nextItems);
    setUsage(data.usage || "");
    setCharCount(Number(data.charCount) || 0);
    setCharLimit(Number(data.charLimit) || 1375);
    setUpdatedAt(data.updatedAt || null);
    setMem0Enabled(Boolean(data.mem0Enabled));
    setMem0Items(Array.isArray(data.mem0Items) ? data.mem0Items : []);
  }

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const data = await api("/api/settings/curated-memory");
      applyStore(data);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * @param {import("react").FormEvent} e
   */
  async function onSaveName(e) {
    e.preventDefault();
    const name = displayName.trim();
    if (!name) return;
    setSavingName(true);
    setOkMsg("");
    try {
      const data = await api("/api/auth/profile", {
        method: "PUT",
        body: JSON.stringify({ name }),
      });
      await refresh();
      setOkMsg(data.message || "Display name saved.");
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setSavingName(false);
    }
  }

  /**
   * @param {import("react").FormEvent} e
   */
  async function onAdd(e) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setSaving(true);
    setOkMsg("");
    try {
      const data = await api("/api/settings/curated-memory", {
        method: "POST",
        body: JSON.stringify({ action: "add", content }),
      });
      applyStore(data);
      setDraft("");
      setOkMsg(data.message || "Entry added.");
      setError(null);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  /**
   * @param {string} entry
   */
  async function onRemove(entry) {
    if (!window.confirm("Remove this USER memory entry?")) return;
    setSaving(true);
    try {
      const data = await api("/api/settings/curated-memory", {
        method: "POST",
        body: JSON.stringify({ action: "remove", oldText: entry.slice(0, 80) }),
      });
      applyStore(data);
      setOkMsg(data.message || "Entry removed.");
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  /**
   * @param {string} id
   */
  async function onRemoveMem0(id) {
    if (!window.confirm("Remove this Mem0 USER pref?")) return;
    setSaving(true);
    try {
      const data = await api(`/api/settings/curated-memory/mem0/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setMem0Items(Array.isArray(data.mem0Items) ? data.mem0Items : []);
      setOkMsg(data.message || "Mem0 entry removed.");
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  async function onClear() {
    if (!window.confirm("Clear all Mongo USER memory entries?")) return;
    setSaving(true);
    try {
      await api("/api/settings/curated-memory", { method: "DELETE" });
      setItems([]);
      setUsage("0% — 0/1,375 chars");
      setCharCount(0);
      setUpdatedAt(new Date().toISOString());
      setOkMsg("Mongo USER memory cleared.");
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  async function onClearMem0() {
    if (!window.confirm("Clear all Mem0 USER prefs? This is what the Memory chip often injects.")) {
      return;
    }
    setSaving(true);
    try {
      const data = await api("/api/settings/curated-memory?mem0Only=1", { method: "DELETE" });
      setMem0Items([]);
      setOkMsg(data.message || "Mem0 USER prefs cleared.");
      setError(null);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  async function onClearAll() {
    if (
      !window.confirm(
        "Clear Mongo USER memory AND Mem0 USER prefs? Agent MEMORY is separate (Agents → Memory)."
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      const data = await api("/api/settings/curated-memory?mem0=1", { method: "DELETE" });
      setItems([]);
      setMem0Items([]);
      setUsage("0% — 0/1,375 chars");
      setCharCount(0);
      setOkMsg(data.message || "All USER prefs cleared.");
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
        <SectionTitle className="mb-1">Display name</SectionTitle>
        <p className="mb-3 text-sm text-teal-900/70">
          Shown on chat bubbles and everywhere as you — not taken from “I am …” in memory.
        </p>
        <form onSubmit={onSaveName} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            <FieldLabel htmlFor="account-display-name">Your name</FieldLabel>
            <input
              id="account-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="min-h-11 rounded-xl border border-teal-200 bg-white px-3 text-sm"
              placeholder="e.g. Yamunesh"
              maxLength={80}
              autoComplete="name"
            />
          </label>
          <button
            type="submit"
            disabled={savingName || !displayName.trim()}
            className="min-h-11 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {savingName ? "Saving…" : "Save name"}
          </button>
        </form>
      </section>

      <SectionTitle>Account memory (USER)</SectionTitle>
      <p className="text-sm text-teal-900/70">
        Stable facts about you — prefs, tone, location — shared by every agent. Cap{" "}
        {charLimit.toLocaleString()} chars for the editable list below. The chat Memory chip
        may also inject <strong>Mem0</strong> USER prefs (separate store) — manage those in the
        Mem0 section.
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
        <p className="text-sm text-teal-900/70">Loading…</p>
      ) : (
        <>
          <section className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
            <h3 className="mb-1 text-sm font-bold text-teal-950">Editable USER entries</h3>
            <p className="mb-2 text-xs text-teal-800/70">
              Usage: {usage || `${charCount}/${charLimit}`}
              {updatedAt ? ` · last changed ${new Date(updatedAt).toLocaleString()}` : ""}
            </p>
            <ul className="mb-3 space-y-2">
              {items.length === 0 ? (
                <li className="text-sm text-teal-900/60">No Mongo USER entries yet.</li>
              ) : (
                items.map((item) => (
                  <li
                    key={`${item.content.slice(0, 48)}-${item.at || "legacy"}`}
                    className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-teal-50 bg-teal-50/40 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      {item.at ? (
                        <div className="text-[0.7rem] font-semibold text-teal-800/60">
                          Added {new Date(item.at).toLocaleString()}
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
                      disabled={saving}
                      onClick={() => onRemove(item.content)}
                      className="min-h-9 shrink-0 rounded-lg border border-rose-200 bg-white px-2 text-xs font-semibold text-rose-800"
                    >
                      Remove
                    </button>
                  </li>
                ))
              )}
            </ul>

            <form onSubmit={onAdd} className="flex flex-col gap-2">
              <FieldLabel htmlFor="user-mem-draft">Add entry</FieldLabel>
              <textarea
                id="user-mem-draft"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-teal-100 bg-white px-3 py-2 text-sm"
                placeholder="e.g. Prefers concise answers; timezone Eastern"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={saving || !draft.trim()}
                  className="min-h-11 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Add
                </button>
                <button
                  type="button"
                  disabled={saving || items.length === 0}
                  onClick={onClear}
                  className="min-h-11 rounded-xl border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-800 disabled:opacity-50"
                >
                  Clear Mongo
                </button>
              </div>
            </form>
          </section>

          <section className="rounded-2xl border border-amber-100 bg-amber-50/40 p-4 shadow-sm">
            <h3 className="mb-1 text-sm font-bold text-teal-950">
              Mem0 USER prefs
              {mem0Enabled ? ` (${mem0Items.length})` : " (off)"}
            </h3>
            <p className="mb-3 text-xs text-teal-800/80">
              Semantic long-term store used by the chat Memory chip under “USER prefs”. If
              Settings looked empty but the chip showed prefs, they lived here.
            </p>
            {!mem0Enabled ? (
              <p className="text-sm text-teal-900/60">Mem0 is disabled on this server.</p>
            ) : (
              <>
                <ul className="mb-3 space-y-2">
                  {mem0Items.length === 0 ? (
                    <li className="text-sm text-teal-900/60">No Mem0 USER prefs stored.</li>
                  ) : (
                    mem0Items.map((item) => (
                      <li
                        key={item.id}
                        className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-amber-100 bg-white px-3 py-2 text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          {item.createdAt ? (
                            <div className="text-[0.7rem] font-semibold text-amber-900/60">
                              {new Date(item.createdAt).toLocaleString()}
                              {item.source ? ` · ${item.source}` : ""}
                            </div>
                          ) : null}
                          <span className="mt-0.5 block whitespace-pre-wrap text-teal-950">
                            {item.content}
                          </span>
                        </div>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => onRemoveMem0(item.id)}
                          className="min-h-9 shrink-0 rounded-lg border border-rose-200 bg-white px-2 text-xs font-semibold text-rose-800"
                        >
                          Remove
                        </button>
                      </li>
                    ))
                  )}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving || mem0Items.length === 0}
                    onClick={onClearMem0}
                    className="min-h-11 rounded-xl border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-800 disabled:opacity-50"
                  >
                    Clear Mem0 USER prefs
                  </button>
                  <button
                    type="button"
                    disabled={saving || (items.length === 0 && mem0Items.length === 0)}
                    onClick={onClearAll}
                    className="min-h-11 rounded-xl border border-rose-300 bg-rose-50 px-4 text-sm font-semibold text-rose-900 disabled:opacity-50"
                  >
                    Clear Mongo + Mem0
                  </button>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
