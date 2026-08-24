/**
 * @fileoverview Settings page — LLM + DeathByCaptcha credentials.
 * Purpose: Store provider secrets on the server for cloud workers to load at runtime.
 * Supports LiteLLM gateway (default when configured), API key, or legacy direct OAuth.
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { ButtonWithHelp, FieldLabel, PageGuideBanner } from "../components/FieldLabel.jsx";
import { HelpToggle } from "../components/HelpToggle.jsx";
import { LlmOAuthModal } from "../components/LlmOAuthModal.jsx";

/**
 * Maps legacy model names to LiteLLM catalog ids.
 * @param {string} model
 * @returns {string}
 */
function normalizeGatewayModelId(model) {
  const m = String(model || "").trim();
  if (!m || m === "MiniMax-M2.7") return "minimax";
  return m;
}

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [form, setForm] = useState({
    llmAuthMode: "api_key",
    llmGatewayMode: "direct",
    litellmEnabled: false,
    litellmModels: [],
    litellmChatGptConnected: false,
    litellmChatGptAccountLabel: "",
    litellmDefaultBaseUrl: "",
    llmApiKey: "",
    llmBaseUrl: "https://api.minimax.io/v1",
    llmModel: "MiniMax-M2.7",
    llmOAuthProvider: "",
    llmOAuthConnected: false,
    llmOAuthAccountLabel: "",
    llmOAuthProviders: [],
    llmOAuthRedirectUri: "",
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
    showAdvancedDirect: false,
  });
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [testingLlm, setTestingLlm] = useState(false);
  const [testingDbc, setTestingDbc] = useState(false);
  const [oauthModalOpen, setOauthModalOpen] = useState(false);
  const [oauthForGateway, setOauthForGateway] = useState(false);

  /**
   * Loads settings from API into form state (secrets left blank).
   */
  async function reloadSettings() {
    const data = await api("/api/settings");
    const settings = data.settings || {};
    const gatewayOn = settings.litellmEnabled === true;
    const normalizedModel = gatewayOn
      ? normalizeGatewayModelId(settings.llmModel)
      : settings.llmModel;
    setForm((prev) => ({
      ...prev,
      ...settings,
      llmModel: normalizedModel,
      llmGatewayMode: gatewayOn ? "litellm" : settings.llmGatewayMode || "direct",
      llmApiKey: "",
      visionApiKey: "",
      dbcPassword: "",
      llmOAuthProvider:
        settings.llmOAuthProvider ||
        settings.llmOAuthProviders?.[0]?.id ||
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

  /** Handle OAuth redirect query params (full-page fallback when popup blocked). */
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

  const useGateway = form.litellmEnabled === true;
  const catalog = Array.isArray(form.litellmModels) ? form.litellmModels : [];
  const gatewayModelId = normalizeGatewayModelId(form.llmModel);
  const selectedCatalog = catalog.find((m) => m.id === gatewayModelId) || null;
  const needsChatGptOAuth =
    useGateway && selectedCatalog?.requiresOAuth && !form.litellmChatGptConnected;

  /**
   * @param {React.FormEvent} e
   */
  async function onSave(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOkMsg("");
    try {
      if (needsChatGptOAuth) {
        setError({
          title: "ChatGPT not connected",
          detail: "Connect ChatGPT before saving a ChatGPT model.",
        });
        setBusy(false);
        return;
      }
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          llmAuthMode: useGateway ? "litellm" : form.llmAuthMode,
          llmGatewayMode: useGateway ? "litellm" : "direct",
          llmApiKey: form.llmApiKey,
          llmBaseUrl: useGateway ? form.litellmDefaultBaseUrl || form.llmBaseUrl : form.llmBaseUrl,
          llmModel: form.llmModel,
          visionApiKey: form.visionApiKey,
          visionBaseUrl: form.visionBaseUrl,
          visionModel: form.visionModel,
          dbcUsername: form.dbcUsername,
          dbcPassword: form.dbcPassword,
          confirmBeforeSubmit: Boolean(form.confirmBeforeSubmit),
        }),
      });
      if (useGateway) {
        await api("/api/settings/litellm/ensure-key", { method: "POST" });
      }
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
    if (needsChatGptOAuth) {
      setError({
        title: "ChatGPT not connected",
        detail: "Connect ChatGPT via LiteLLM before testing a ChatGPT model.",
      });
      return;
    }
    setTestingLlm(true);
    setError(null);
    setOkMsg("");
    try {
      const data = await api("/api/settings/test-llm", {
        method: "POST",
        body: JSON.stringify({
          llmApiKey: form.llmApiKey,
          llmBaseUrl: useGateway ? form.litellmDefaultBaseUrl || form.llmBaseUrl : form.llmBaseUrl,
          llmModel: form.llmModel,
        }),
      });
      const preview = data.preview ? ` Reply: "${data.preview}"` : "";
      const mode =
        data.authMode === "litellm" ? " (LiteLLM gateway)" : data.authMode === "oauth" ? " (OAuth)" : "";
      setOkMsg(`${data.message || "LLM connected."}${mode} Model: ${data.model || form.llmModel}.${preview}`);
    } catch (err) {
      setError(err);
    } finally {
      setTestingLlm(false);
    }
  }

  /**
   * Clears legacy direct OAuth tokens.
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
   * Clears ChatGPT OAuth on the LiteLLM gateway.
   */
  async function disconnectGatewayChatGpt() {
    setBusy(true);
    setError(null);
    setOkMsg("");
    try {
      await api("/api/settings/litellm/oauth/chatgpt/disconnect", { method: "POST" });
      setOkMsg("ChatGPT disconnected from LiteLLM gateway.");
      await reloadSettings();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  /**
   * @param {{ provider: string, account?: string }} result
   */
  async function onOAuthConnected(result) {
    if (oauthForGateway) {
      setOauthForGateway(false);
      setBusy(true);
      setError(null);
      try {
        const chatGptUpstream = catalog.find((m) => m.requiresOAuth && String(m.id).startsWith("chatgpt/"))?.id
          || (String(form.llmModel || "").startsWith("chatgpt/") ? form.llmModel : "chatgpt/gpt-5.3-codex");
        const data = await api("/api/settings/litellm/oauth/chatgpt/import-codex", {
          method: "POST",
          body: JSON.stringify({ model: chatGptUpstream }),
        });
        setOkMsg(
          data.account
            ? `ChatGPT connected via browser sign-in (${data.account}). Test LLM to verify.`
            : "ChatGPT connected via browser sign-in. Test LLM to verify."
        );
        await reloadSettings();
      } catch (err) {
        setError(err);
      } finally {
        setBusy(false);
      }
      return;
    }
    update("llmAuthMode", "oauth");
    setOkMsg(
      result.account
        ? `OAuth connected (${result.provider}): ${result.account}. Test LLM to verify.`
        : `OAuth connected (${result.provider}). Test LLM to verify.`
    );
    reloadSettings().catch((err) => setError(err));
  }

  /**
   * Opens ChatGPT browser sign-in (popup + paste URL) for LiteLLM gateway.
   */
  function startGatewayChatGptConnect() {
    setOauthForGateway(true);
    setOauthModalOpen(true);
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

  const useOAuth = !useGateway && form.llmAuthMode === "oauth";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      <HelpToggle />
      <PageGuideBanner helpId="nav.settings" />
      <p className="text-sm text-teal-900/70">
        {useGateway
          ? "LLM requests route through the LiteLLM gateway (OAuth + provider keys managed there)."
          : "Default provider is Minimax. Use an API key or sign in with OAuth. Secrets are encrypted at rest."}
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

      <LlmOAuthModal
        open={oauthModalOpen}
        onClose={() => {
          setOauthModalOpen(false);
          setOauthForGateway(false);
        }}
        onConnected={onOAuthConnected}
        gatewayChatGpt={oauthForGateway}
        providers={
          oauthForGateway
            ? (form.llmOAuthProviders || []).filter((p) => p.id === "openai").length
              ? (form.llmOAuthProviders || []).filter((p) => p.id === "openai")
              : [
                  {
                    id: "openai",
                    label: "ChatGPT (OpenAI)",
                    ready: true,
                    needsPasteCallback: true,
                  },
                ]
            : form.llmOAuthProviders
        }
        redirectUri={form.llmOAuthRedirectUri}
        llmBaseUrl={form.llmBaseUrl}
        llmModel={form.llmModel}
      />

      <form onSubmit={onSave} className="flex flex-col gap-3 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-teal-900/80">LLM</h2>

        {useGateway ? (
          <>
            <p className="rounded-xl border border-teal-50 bg-teal-50/50 p-3 text-sm text-teal-900/80">
              Gateway mode — workers call{" "}
              <code className="rounded bg-white px-1">{form.litellmDefaultBaseUrl || "LiteLLM /v1"}</code>
            </p>

            <label className="flex flex-col gap-1 text-sm">
              <FieldLabel helpId="settings.litellmModel">Model</FieldLabel>
              <select
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                value={catalog.some((m) => m.id === gatewayModelId) ? gatewayModelId : catalog[0]?.id || gatewayModelId}
                onChange={(e) => update("llmModel", e.target.value)}
              >
                {catalog.length ? (
                  catalog.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                      {m.requiresOAuth ? " (ChatGPT)" : ""}
                    </option>
                  ))
                ) : (
                  <option value="minimax">MiniMax M2.7</option>
                )}
              </select>
            </label>

            <div className="flex flex-col gap-2 rounded-xl border border-teal-50 bg-teal-50/40 p-3 text-sm">
              <p className="font-semibold text-teal-900">ChatGPT subscription</p>
              {form.litellmChatGptConnected ? (
                <>
                  <p className="text-teal-900">
                    Connected
                    {form.litellmChatGptAccountLabel ? `: ${form.litellmChatGptAccountLabel}` : ""}
                  </p>
                  <p className="text-xs text-teal-900/70">
                    Pick a ChatGPT model above to use your subscription. MiniMax uses the platform API key.
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <ButtonWithHelp helpId="settings.litellmChatGpt">
                      <button
                        type="button"
                        onClick={startGatewayChatGptConnect}
                        disabled={busy}
                        className="min-h-11 rounded-xl border border-teal-200 bg-white px-4 font-semibold text-teal-900 disabled:opacity-50"
                      >
                        Reconnect ChatGPT
                      </button>
                    </ButtonWithHelp>
                    <button
                      type="button"
                      onClick={disconnectGatewayChatGpt}
                      disabled={busy}
                      className="min-h-11 rounded-xl border border-teal-200 bg-white px-4 font-semibold text-teal-900 disabled:opacity-50"
                    >
                      Disconnect
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-teal-900/80">
                    Opens a ChatGPT login popup. After sign-in, paste the redirect URL from the popup
                    address bar — no device code needed.
                  </p>
                  <ButtonWithHelp helpId="settings.litellmChatGpt">
                    <button
                      type="button"
                      onClick={startGatewayChatGptConnect}
                      disabled={busy}
                      className="min-h-11 w-full rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50 sm:w-auto"
                    >
                      Connect ChatGPT…
                    </button>
                  </ButtonWithHelp>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => update("showAdvancedDirect", !form.showAdvancedDirect)}
              className="text-left text-sm font-semibold text-teal-800 underline"
            >
              {form.showAdvancedDirect ? "Hide" : "Show"} direct provider settings (advanced)
            </button>
          </>
        ) : null}

        {(!useGateway || form.showAdvancedDirect) && (
          <>
            {!useGateway ? (
              <fieldset className="flex flex-col gap-2 text-sm">
                <FieldLabel helpId="settings.llmAuthMode">Authentication</FieldLabel>
                <label className="flex min-h-11 items-center gap-2">
                  <input
                    type="radio"
                    name="llmAuthMode"
                    checked={!useOAuth}
                    onChange={() => {
                      update("llmAuthMode", "api_key");
                      update("llmGatewayMode", "direct");
                    }}
                  />
                  API key (MiniMax, any OpenAI-compatible provider)
                </label>
                <label className="flex min-h-11 items-center gap-2">
                  <input
                    type="radio"
                    name="llmAuthMode"
                    checked={useOAuth}
                    onChange={() => {
                      update("llmAuthMode", "oauth");
                      update("llmGatewayMode", "direct");
                    }}
                  />
                  OAuth sign-in (Google Gemini, Azure OpenAI, OpenAI)
                </label>
              </fieldset>
            ) : null}

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
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <ButtonWithHelp helpId="settings.llmOAuthConnect">
                        <button
                          type="button"
                          onClick={() => setOauthModalOpen(true)}
                          disabled={busy}
                          className="min-h-11 rounded-xl border border-teal-200 bg-white px-4 font-semibold text-teal-900 disabled:opacity-50"
                        >
                          Reconnect
                        </button>
                      </ButtonWithHelp>
                      <button
                        type="button"
                        onClick={disconnectOAuth}
                        disabled={busy}
                        className="min-h-11 rounded-xl border border-teal-200 bg-white px-4 font-semibold text-teal-900 disabled:opacity-50"
                      >
                        Disconnect
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-teal-900/80">
                      Sign in with your LLM provider. A popup opens so you can pick the provider and log in on their site.
                    </p>
                    <ButtonWithHelp helpId="settings.llmOAuthConnect">
                      <button
                        type="button"
                        onClick={() => setOauthModalOpen(true)}
                        disabled={busy}
                        className="min-h-11 w-full rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50 sm:w-auto"
                      >
                        Connect account…
                      </button>
                    </ButtonWithHelp>
                  </>
                )}
              </div>
            )}

            {!useGateway ? (
              <>
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
              </>
            ) : null}
          </>
        )}

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
