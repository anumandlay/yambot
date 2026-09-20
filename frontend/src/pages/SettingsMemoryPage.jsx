/**
 * @fileoverview Account USER.md curated memory — Hermes-style prefs/identity.
 * Purpose: Let operators set display name + view/add/clear the shared user profile store.
 * Downstream: PUT `/api/auth/profile`; GET/POST/PUT/DELETE `/api/settings/curated-memory`.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { FieldLabel, SectionTitle } from "../components/FieldLabel.jsx";

/**
 * Settings tab for account name + curated USER memory.
 */
export function SettingsMemoryPage() {
  const { user, refresh } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [items, setItems] = useState([]);
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

  async function onClear() {
    if (!window.confirm("Clear all account USER memory?")) return;
    setSaving(true);
    try {
      await api("/api/settings/curated-memory", { method: "DELETE" });
      setItems([]);
      setUsage("0% — 0/1,375 chars");
      setCharCount(0);
      setUpdatedAt(new Date().toISOString());
      setOkMsg("USER memory cleared.");
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
        {charLimit.toLocaleString()} chars. Your display name above is separate from these facts.
        Injected frozen at the start of each run; mid-run agent writes appear on the next task.
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
          <p className="text-xs font-semibold text-teal-800/80">
            Usage: {usage || `${charCount}/${charLimit}`}
            {updatedAt ? ` · last changed ${new Date(updatedAt).toLocaleString()}` : ""}
          </p>
          <ul className="space-y-2">
            {items.length === 0 ? (
              <li className="text-sm text-teal-900/60">No USER entries yet.</li>
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
                Clear all
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
