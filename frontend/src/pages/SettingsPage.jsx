/**
 * @fileoverview Settings page — LLM + DeathByCaptcha credentials.
 * Purpose: Store provider API keys on the server for cloud workers to load at runtime.
 */

import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { ButtonWithHelp, FieldLabel } from "../components/FieldLabel.jsx";

export function SettingsPage() {
  const [form, setForm] = useState({
    llmApiKey: "",
    llmBaseUrl: "https://api.minimax.io/v1",
    llmModel: "MiniMax-M2.7",
    llmContextTokens: "",
    dbcUsername: "",
    dbcPassword: "",
    confirmBeforeSubmit: false,
    llmApiKeyMasked: "",
    dbcPasswordMasked: "",
    hasLlmApiKey: false,
    hasDbcPassword: false,
  });
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [testingDbc, setTestingDbc] = useState(false);
  const [testingLlm, setTestingLlm] = useState(false);

  /**
   * Loads settings from API into form state (full API keys / secrets shown).
   */
  async function reloadSettings() {
    const data = await api("/api/settings");
    const settings = data.settings || {};
    setForm((prev) => ({
      ...prev,
      ...settings,
      llmApiKey: settings.llmApiKey || "",
      dbcPassword: settings.dbcPassword || "",
      llmContextTokens:
        settings.llmContextTokens > 0 ? String(settings.llmContextTokens) : "",
    }));
  }

  useEffect(() => {
    (async () => {
      try {
        await reloadSettings();
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
          llmAuthMode: "api_key",
          llmApiKey: form.llmApiKey,
          llmBaseUrl: form.llmBaseUrl,
          llmModel: form.llmModel,
          llmContextTokens:
            form.llmContextTokens === "" ? 0 : Number(form.llmContextTokens) || 0,
          dbcUsername: form.dbcUsername,
          dbcPassword: form.dbcPassword,
          confirmBeforeSubmit: Boolean(form.confirmBeforeSubmit),
        }),
      });
      setOkMsg("Settings saved. Agents use these on the next task.");
      await reloadSettings();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Verifies LLM credentials with values in the form (or the saved API key if blank).
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
      const preview = data.preview ? ` Reply: “${data.preview}”.` : "";
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
    <div className="flex flex-col gap-4">
      <p className="text-sm text-teal-900/70">
        Default provider is MiniMax. Enter your API key, base URL, and model. Secrets are encrypted at rest.
        To use ChatGPT instead, open the <strong>OpenAI OAuth</strong> tab.
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
          <FieldLabel helpId="settings.llmApiKey">API key</FieldLabel>
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3 font-mono text-sm"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-…"
            value={form.llmApiKey}
            onChange={(e) => update("llmApiKey", e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="settings.llmBaseUrl">Base URL</FieldLabel>
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.llmBaseUrl}
            onChange={(e) => update("llmBaseUrl", e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="settings.llmModel">Model</FieldLabel>
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.llmModel}
            onChange={(e) => update("llmModel", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="settings.llmContextTokens">Context size (tokens)</FieldLabel>
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            type="number"
            min="8000"
            step="1000"
            value={form.llmContextTokens}
            onChange={(e) => update("llmContextTokens", e.target.value)}
            placeholder="Leave blank to infer from model (e.g. 128000)"
          />
          <span className="text-xs text-teal-900/60">
            Chat memory scales to this window. Blank = guess from the model name.
          </span>
        </label>
        <ButtonWithHelp helpId="settings.testLlm">
          <button
            type="button"
            onClick={testLlm}
            disabled={testingLlm || busy}
            className="min-h-11 w-full rounded-xl border border-teal-200 bg-teal-50 px-4 font-semibold text-teal-900 disabled:opacity-50 sm:w-auto"
          >
            {testingLlm ? "Testing…" : "Test LLM connection"}
          </button>
        </ButtonWithHelp>

        <h2 className="mt-2 text-sm font-semibold text-teal-900/80">DeathByCaptcha</h2>
        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="settings.dbcUsername">Username</FieldLabel>
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.dbcUsername}
            onChange={(e) => update("dbcUsername", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="settings.dbcPassword">Password / authtoken</FieldLabel>
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3 font-mono text-sm"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={form.dbcPassword}
            onChange={(e) => update("dbcPassword", e.target.value)}
          />
        </label>
        <ButtonWithHelp helpId="settings.testDbc">
          <button
            type="button"
            onClick={testDbc}
            disabled={testingDbc || busy}
            className="min-h-11 w-full rounded-xl border border-teal-200 bg-teal-50 px-4 font-semibold text-teal-900 disabled:opacity-50 sm:w-auto"
          >
            {testingDbc ? "Testing…" : "Test DeathByCaptcha connection"}
          </button>
        </ButtonWithHelp>

        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(form.confirmBeforeSubmit)}
            onChange={(e) => update("confirmBeforeSubmit", e.target.checked)}
          />
          <FieldLabel helpId="settings.confirmBeforeSubmit">
            Ask me before submit/apply clicks (off = fully automatic)
          </FieldLabel>
        </label>

        <ButtonWithHelp helpId="settings.save">
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save settings"}
          </button>
        </ButtonWithHelp>
      </form>
    </div>
  );
}
