/**
 * @fileoverview Settings page — LLM + DeathByCaptcha credentials.
 * Purpose: Store provider secrets on the server for cloud workers to load at runtime.
 */

import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";

export function SettingsPage() {
  const [form, setForm] = useState({
    llmApiKey: "",
    llmBaseUrl: "https://api.minimax.io/v1",
    llmModel: "MiniMax-M2.7",
    visionApiKey: "",
    visionBaseUrl: "",
    visionModel: "",
    dbcUsername: "",
    dbcPassword: "",
    confirmBeforeSubmit: false,
    llmApiKeyMasked: "",
    visionApiKeyMasked: "",
    dbcPasswordMasked: "",
    hasLlmApiKey: false,
    hasVisionApiKey: false,
    hasDbcPassword: false,
  });
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [testingLlm, setTestingLlm] = useState(false);
  const [testingDbc, setTestingDbc] = useState(false);

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
          visionApiKey: form.visionApiKey,
          visionBaseUrl: form.visionBaseUrl,
          visionModel: form.visionModel,
          dbcUsername: form.dbcUsername,
          dbcPassword: form.dbcPassword,
          confirmBeforeSubmit: Boolean(form.confirmBeforeSubmit),
        }),
      });
      setOkMsg("Settings saved. Agents use these on the next task — click Test LLM connection to verify.");
      setForm((prev) => ({ ...prev, llmApiKey: "", visionApiKey: "", dbcPassword: "" }));
      const data = await api("/api/settings");
      setForm((prev) => ({ ...prev, ...data.settings, llmApiKey: "", visionApiKey: "", dbcPassword: "" }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Verifies LLM credentials with values in the form (or the saved key if blank).
   */
  async function testLlm() {
    setTestingLlm(true);
    setError(null);
    setOkMsg("");
    try {
      const data = await api("/api/settings/test-llm", {
        method: "POST",
        body: JSON.stringify({
          llmApiKey: form.llmApiKey,
          llmBaseUrl: form.llmBaseUrl,
          llmModel: form.llmModel,
        }),
      });
      const preview = data.preview ? ` Reply: "${data.preview}"` : "";
      setOkMsg(`${data.message || "LLM connected."} Model: ${data.model || form.llmModel}.${preview}`);
    } catch (err) {
      setError(err);
    } finally {
      setTestingLlm(false);
    }
  }

  /**
   * Verifies DeathByCaptcha with values in the form (or the saved password if blank).
   */
  async function testDbc() {
    setTestingDbc(true);
    setError(null);
    setOkMsg("");
    try {
      const data = await api("/api/settings/test-dbc", {
        method: "POST",
        body: JSON.stringify({
          dbcUsername: form.dbcUsername,
          dbcPassword: form.dbcPassword,
        }),
      });
      const bal =
        data.balanceCents == null
          ? ""
          : ` Balance: ${(Number(data.balanceCents) / 100).toFixed(2)} USD.`;
      setOkMsg(`${data.message || "DeathByCaptcha connected."}${bal}`);
    } catch (err) {
      setError(err);
    } finally {
      setTestingDbc(false);
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
        <button
          type="button"
          onClick={testLlm}
          disabled={testingLlm || busy}
          className="min-h-11 w-full rounded-xl border border-teal-200 bg-teal-50 px-4 font-semibold text-teal-900 disabled:opacity-50 sm:w-auto"
        >
          {testingLlm ? "Testing…" : "Test LLM connection"}
        </button>

        <h2 className="mt-2 text-sm font-semibold text-teal-900/80">Vision LLM (optional)</h2>
        <p className="text-xs text-teal-900/60">
          Used when the cloud worker attaches viewport screenshots after verification failures.
          Leave blank to reuse the main LLM credentials — set a vision-capable model if your text model
          does not accept images.
        </p>
        <label className="flex flex-col gap-1 text-sm">
          Vision API key {form.hasVisionApiKey ? `(saved: ${form.visionApiKeyMasked})` : ""}
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            type="password"
            autoComplete="off"
            placeholder="Leave blank to use main LLM key"
            value={form.visionApiKey}
            onChange={(e) => update("visionApiKey", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Vision base URL
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            placeholder="Same as main LLM if empty"
            value={form.visionBaseUrl}
            onChange={(e) => update("visionBaseUrl", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Vision model
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            placeholder="e.g. gpt-4o-mini — same as main LLM if empty"
            value={form.visionModel}
            onChange={(e) => update("visionModel", e.target.value)}
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
        <button
          type="button"
          onClick={testDbc}
          disabled={testingDbc || busy}
          className="min-h-11 w-full rounded-xl border border-teal-200 bg-teal-50 px-4 font-semibold text-teal-900 disabled:opacity-50 sm:w-auto"
        >
          {testingDbc ? "Testing…" : "Test DeathByCaptcha connection"}
        </button>

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
