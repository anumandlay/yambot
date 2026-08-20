/**
 * @fileoverview Settings page — LLM + DeathByCaptcha credentials.
 * Purpose: Store provider secrets on the server so the Chrome extension loads them at runtime
 * instead of requiring keys only inside the extension UI.
 */

import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";

export function SettingsPage() {
  const [form, setForm] = useState({
    llmApiKey: "",
    llmBaseUrl: "https://api.minimax.io/v1",
    llmModel: "MiniMax-M2.7",
    dbcUsername: "",
    dbcPassword: "",
    maxSteps: 25,
    confirmBeforeSubmit: false,
    llmApiKeyMasked: "",
    dbcPasswordMasked: "",
    hasLlmApiKey: false,
    hasDbcPassword: false,
  });
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await api("/api/settings");
        setForm((prev) => ({ ...prev, ...data.settings, llmApiKey: "", dbcPassword: "" }));
      } catch (err) {
        setError(err);
      }
    })();
  }, []);

  /**
   * @param {string} key
   * @param {string|number|boolean} value
   */
  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  /**
   * @param {React.FormEvent} e
   */
  async function onSave(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOkMsg("");
    try {
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          llmApiKey: form.llmApiKey,
          llmBaseUrl: form.llmBaseUrl,
          llmModel: form.llmModel,
          dbcUsername: form.dbcUsername,
          dbcPassword: form.dbcPassword,
          maxSteps: Number(form.maxSteps) || 25,
          confirmBeforeSubmit: Boolean(form.confirmBeforeSubmit),
        }),
      });
      setOkMsg("Settings saved. The Chrome extension will use these on the next task.");
      setForm((prev) => ({ ...prev, llmApiKey: "", dbcPassword: "" }));
      const data = await api("/api/settings");
      setForm((prev) => ({ ...prev, ...data.settings, llmApiKey: "", dbcPassword: "" }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      <p className="text-sm text-teal-900/70">
        Default provider is Minimax (<code className="rounded bg-teal-50 px-1">MiniMax-M2.7</code>).
        Secrets are saved on the server — leave the API key blank to keep the current value.
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
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {okMsg}
        </div>
      ) : null}

      <form onSubmit={onSave} className="flex flex-col gap-3 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-teal-900/80">LLM</h2>
        <label className="flex flex-col gap-1 text-sm">
          API key {form.hasLlmApiKey ? `(saved: ${form.llmApiKeyMasked})` : ""}
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            type="password"
            autoComplete="off"
            placeholder="sk-…"
            value={form.llmApiKey}
            onChange={(e) => update("llmApiKey", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Base URL
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.llmBaseUrl}
            onChange={(e) => update("llmBaseUrl", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Model
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.llmModel}
            onChange={(e) => update("llmModel", e.target.value)}
          />
        </label>

        <h2 className="mt-2 text-sm font-semibold text-teal-900/80">DeathByCaptcha</h2>
        <label className="flex flex-col gap-1 text-sm">
          Username
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.dbcUsername}
            onChange={(e) => update("dbcUsername", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password / authtoken {form.hasDbcPassword ? `(saved: ${form.dbcPasswordMasked})` : ""}
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            type="password"
            value={form.dbcPassword}
            onChange={(e) => update("dbcPassword", e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Max steps
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            type="number"
            min={5}
            max={100}
            value={form.maxSteps}
            onChange={(e) => update("maxSteps", e.target.value)}
          />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(form.confirmBeforeSubmit)}
            onChange={(e) => update("confirmBeforeSubmit", e.target.checked)}
          />
          Ask me before submit/apply clicks (off = fully automatic)
        </label>

        <button
          type="submit"
          disabled={busy}
          className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save settings"}
        </button>
      </form>
    </div>
  );
}
