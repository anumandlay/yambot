/**
 * @fileoverview Settings page — LLM + DeathByCaptcha credentials.
 * Purpose: Store provider secrets on the server for cloud workers to load at runtime.
 * Supports API key or OAuth (Azure OpenAI, Google Gemini, OpenAI when configured).
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { ButtonWithHelp, FieldLabel, PageGuideBanner } from "../components/FieldLabel.jsx";
import { HelpToggle } from "../components/HelpToggle.jsx";

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [form, setForm] = useState({
    llmAuthMode: "api_key",
    llmApiKey: "",
    llmBaseUrl: "https://api.minimax.io/v1",
    llmModel: "MiniMax-M2.7",
    llmOAuthProvider: "",
    llmOAuthConnected: false,
    llmOAuthAccountLabel: "",
    llmOAuthProviders: [],
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
  const [connectingOAuth, setConnectingOAuth] = useState(false);

  /**
   * Loads settings from API into form state (secrets left blank).
   */
  async function reloadSettings() {
    const data = await api("/api/settings");
    setForm((prev) => ({
      ...prev,
      ...data.settings,
      llmApiKey: "",
      visionApiKey: "",
      dbcPassword: "",
      llmOAuthProvider:
        data.settings.llmOAuthProvider ||
        data.settings.llmOAuthProviders?.[0]?.id ||
        prev.llmOAuthProvider ||
        "",
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

  /** Handle OAuth redirect query params from provider callback. */
  useEffect(() => {
    const oauthResult = searchParams.get("llm_oauth");
    if (!oauthResult) return;

    if (oauthResult === "connected") {
      const provider = searchParams.get("provider") || "";
      const account = searchParams.get("account") || "";
      setOkMsg(
        account
          ? `OAuth connected (${provider}): ${account}. Test LLM to verify.`
          : `OAuth connected (${provider}). Test LLM to verify.`
      );
      reloadSettings().catch((err) => setError(err));
    } else if (oauthResult === "error") {
      const detail = searchParams.get("detail") || "OAuth failed";
      setError({ title: "OAuth failed", detail, message: detail });
    }

    searchParams.delete("llm_oauth");
    searchParams.delete("provider");
    searchParams.delete("account");
    searchParams.delete("detail");
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams]);

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
          llmAuthMode: form.llmAuthMode,
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
      await reloadSettings();
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
      const mode = data.authMode === "oauth" ? " (OAuth)" : "";
      setOkMsg(`${data.message || "LLM connected."}${mode} Model: ${data.model || form.llmModel}.${preview}`);
    } catch (err) {
      setError(err);
    } finally {
      setTestingLlm(false);
    }
  }

  /**
   * Starts OAuth connect — redirects browser to provider authorize URL.
   */
  async function connectOAuth() {
    const provider = String(form.llmOAuthProvider || "").trim();
    if (!provider) {
      setError({ title: "Choose a provider", detail: "Select an OAuth provider before connecting." });
      return;
    }
    setConnectingOAuth(true);
    setError(null);
    setOkMsg("");
    try {
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          llmAuthMode: "oauth",
          llmBaseUrl: form.llmBaseUrl,
          llmModel: form.llmModel,
        }),
      });
      const data = await api("/api/settings/llm/oauth/start", {
        method: "POST",
        body: JSON.stringify({ provider }),
      });
      if (data.authorizeUrl) {
        window.location.href = data.authorizeUrl;
        return;
      }
      setError({ title: "OAuth failed", detail: "No authorize URL returned" });
    } catch (err) {
      setError(err);
    } finally {
      setConnectingOAuth(false);
    }
  }

  /**
   * Clears OAuth tokens and reverts to API key mode.
   */
  async function disconnectOAuth() {
    setBusy(true);
    setError(null);
    setOkMsg("");
    try {
      await api("/api/settings/llm/oauth/disconnect", { method: "POST" });
      setOkMsg("OAuth disconnected. Using API key mode.");
      await reloadSettings();
      update("llmAuthMode", "api_key");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
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

  const oauthAvailable = Array.isArray(form.llmOAuthProviders) && form.llmOAuthProviders.length > 0;
  const useOAuth = form.llmAuthMode === "oauth";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      <HelpToggle />
      <PageGuideBanner helpId="nav.settings" />
      <p className="text-sm text-teal-900/70">
        Default provider is Minimax (<code className="rounded bg-teal-50 px-1">MiniMax-M2.7</code>).
        Use an API key or OAuth (when configured on the server). Secrets are encrypted at rest.
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

        <fieldset className="flex flex-col gap-2 text-sm">
          <FieldLabel helpId="settings.llmAuthMode">Authentication</FieldLabel>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="radio"
              name="llmAuthMode"
              checked={!useOAuth}
              onChange={() => update("llmAuthMode", "api_key")}
            />
            API key (MiniMax, any OpenAI-compatible provider)
          </label>
          <label className={`flex min-h-11 items-center gap-2 ${!oauthAvailable ? "opacity-60" : ""}`}>
            <input
              type="radio"
              name="llmAuthMode"
              checked={useOAuth}
              disabled={!oauthAvailable}
              onChange={() => update("llmAuthMode", "oauth")}
            />
            OAuth sign-in
            {!oauthAvailable ? (
              <span className="text-xs text-teal-900/50">(not configured on this server)</span>
            ) : null}
          </label>
        </fieldset>

        {!useOAuth ? (
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="settings.llmApiKey">
              API key {form.hasLlmApiKey ? `(saved: ${form.llmApiKeyMasked})` : ""}
            </FieldLabel>
            <input
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              type="password"
              autoComplete="off"
              placeholder="sk-…"
              value={form.llmApiKey}
              onChange={(e) => update("llmApiKey", e.target.value)}
            />
          </label>
        ) : (
          <div className="flex flex-col gap-2 rounded-xl border border-teal-50 bg-teal-50/40 p-3 text-sm">
            {form.llmOAuthConnected ? (
              <>
                <p className="text-teal-900">
                  Connected
                  {form.llmOAuthAccountLabel ? `: ${form.llmOAuthAccountLabel}` : ""}
                  {form.llmOAuthProvider ? ` (${form.llmOAuthProvider})` : ""}
                </p>
                <button
                  type="button"
                  onClick={disconnectOAuth}
                  disabled={busy}
                  className="min-h-11 w-full rounded-xl border border-teal-200 bg-white px-4 font-semibold text-teal-900 disabled:opacity-50 sm:w-auto"
                >
                  Disconnect OAuth
                </button>
              </>
            ) : (
              <>
                <label className="flex flex-col gap-1">
                  <span className="font-medium text-teal-900/80">Provider</span>
                  <select
                    className="min-h-11 rounded-xl border border-teal-100 bg-white px-3"
                    value={form.llmOAuthProvider}
                    onChange={(e) => update("llmOAuthProvider", e.target.value)}
                  >
                    {form.llmOAuthProviders.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                {form.llmOAuthProviders.find((p) => p.id === form.llmOAuthProvider)?.hint ? (
                  <p className="text-xs text-teal-900/60">
                    {form.llmOAuthProviders.find((p) => p.id === form.llmOAuthProvider)?.hint}
                  </p>
                ) : null}
                <ButtonWithHelp helpId="settings.llmOAuthConnect">
                  <button
                    type="button"
                    onClick={connectOAuth}
                    disabled={connectingOAuth || busy}
                    className="min-h-11 w-full rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50 sm:w-auto"
                  >
                    {connectingOAuth ? "Redirecting…" : "Connect with OAuth"}
                  </button>
                </ButtonWithHelp>
              </>
            )}
          </div>
        )}

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

        <h2 className="mt-2 text-sm font-semibold text-teal-900/80">Vision LLM (optional)</h2>
        <p className="text-xs text-teal-900/60">
          Used when the cloud worker attaches viewport screenshots after verification failures.
          Leave blank to reuse the main LLM credentials — set a vision-capable model if your text model
          does not accept images.
        </p>
        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="settings.visionApiKey">
            Vision API key {form.hasVisionApiKey ? `(saved: ${form.visionApiKeyMasked})` : ""}
          </FieldLabel>
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
          <FieldLabel helpId="settings.visionBaseUrl">Vision base URL</FieldLabel>
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            placeholder="Same as main LLM if empty"
            value={form.visionBaseUrl}
            onChange={(e) => update("visionBaseUrl", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="settings.visionModel">Vision model</FieldLabel>
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            placeholder="e.g. gpt-4o-mini — same as main LLM if empty"
            value={form.visionModel}
            onChange={(e) => update("visionModel", e.target.value)}
          />
        </label>

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
          <FieldLabel helpId="settings.dbcPassword">
            Password / authtoken {form.hasDbcPassword ? `(saved: ${form.dbcPasswordMasked})` : ""}
          </FieldLabel>
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            type="password"
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
