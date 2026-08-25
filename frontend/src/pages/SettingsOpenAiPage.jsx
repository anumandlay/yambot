/**
 * @fileoverview Settings → OpenAI OAuth — connect ChatGPT subscription as the LLM.
 * Purpose: PKCE sign-in flow; tokens stored encrypted; workers use Codex backend.
 * Downstream: `/api/settings/llm/oauth/*` routes.
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { ButtonWithHelp, FieldLabel } from "../components/FieldLabel.jsx";

/**
 * OpenAI OAuth connect page under Settings submenu.
 */
export function SettingsOpenAiPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState({
    connected: false,
    accountLabel: "",
    llmModel: "gpt-4o",
    llmAuthMode: "api_key",
  });
  const [pastedCallback, setPastedCallback] = useState("");
  const [showPasteStep, setShowPasteStep] = useState(false);
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState("");
  const [busy, setBusy] = useState(false);

  /**
   * Loads OAuth connection status from settings API.
   */
  async function reload() {
    const data = await api("/api/settings");
    const s = data.settings || {};
    setStatus({
      connected: Boolean(s.llmOAuthConnected),
      accountLabel: s.llmOAuthAccountLabel || "",
      llmModel: s.llmModel || "gpt-4o",
      llmAuthMode: s.llmAuthMode || "api_key",
    });
  }

  useEffect(() => {
    (async () => {
      try {
        await reload();
      } catch (err) {
        setError(err);
      }
    })();
  }, []);

  useEffect(() => {
    const oauthResult = searchParams.get("llm_oauth");
    if (!oauthResult) return;
    if (oauthResult === "connected") {
      const account = searchParams.get("account") || "";
      setOkMsg(account ? `Connected as ${account}` : "OpenAI connected.");
      reload().catch(() => {});
    } else if (oauthResult === "error") {
      setError({
        title: "OAuth failed",
        detail: searchParams.get("detail") || "Sign-in failed.",
      });
    }
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  /**
   * Finishes OAuth from pasted loopback callback URL.
   */
  async function completePaste() {
    if (!pastedCallback.trim()) {
      setError({ title: "Missing URL", detail: "Paste the full redirect URL from the popup." });
      return;
    }
    setBusy(true);
    setError(null);
    setOkMsg("");
    try {
      const data = await api("/api/settings/llm/oauth/complete-paste", {
        method: "POST",
        body: JSON.stringify({ pastedInput: pastedCallback.trim() }),
      });
      setOkMsg(data.account ? `Connected as ${data.account}` : data.message || "OpenAI connected.");
      setShowPasteStep(false);
      setPastedCallback("");
      await reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Opens ChatGPT sign-in popup and waits for postMessage or paste step.
   */
  async function onConnect() {
    setBusy(true);
    setError(null);
    setOkMsg("");
    try {
      const data = await api("/api/settings/llm/oauth/start", {
        method: "POST",
        body: JSON.stringify({ provider: "openai", popup: true }),
      });
      if (!data.authorizeUrl) {
        setError({ title: "OAuth error", detail: "No authorize URL returned." });
        return;
      }
      if (data.needsPasteCallback) {
        setShowPasteStep(true);
      }
      const popup = window.open(
        data.authorizeUrl,
        "yambot_openai_oauth",
        "width=520,height=720,menubar=no,toolbar=no,location=yes,status=no"
      );
      if (!popup) {
        setError({
          title: "Popup blocked",
          detail: "Allow popups for this site, then try again.",
        });
        return;
      }
      if (data.needsPasteCallback) {
        setBusy(false);
        return;
      }
      await new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          cleanup();
          reject(new Error("Sign-in timed out. Close the popup and try again."));
        }, 10 * 60 * 1000);
        /** @param {MessageEvent} ev */
        function onMessage(ev) {
          if (ev.origin !== window.location.origin) return;
          const msg = ev.data;
          if (!msg || msg.type !== "yambot_llm_oauth") return;
          cleanup();
          if (msg.ok) resolve(msg);
          else reject(new Error(msg.detail || "OAuth failed"));
        }
        function cleanup() {
          window.clearTimeout(timeout);
          window.removeEventListener("message", onMessage);
        }
        window.addEventListener("message", onMessage);
      });
      setOkMsg("OpenAI connected.");
      await reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Clears OAuth tokens and reverts to API key mode.
   */
  async function onDisconnect() {
    setBusy(true);
    setError(null);
    setOkMsg("");
    try {
      await api("/api/settings/llm/oauth/disconnect", { method: "POST" });
      setOkMsg("OpenAI disconnected. Agents will use API key settings.");
      await reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const active = status.connected && status.llmAuthMode === "oauth";

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-teal-900/70">
        Sign in with your ChatGPT account to use your subscription as the agent LLM — no OpenAI API key
        required. When connected, this overrides the API key on the <strong>API key</strong> tab.
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

      <div className="flex flex-col gap-3 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-teal-900/80">ChatGPT connection</h2>

        {active ? (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 text-sm text-emerald-900">
            <p className="font-medium">Connected</p>
            <p className="mt-1 text-emerald-800/90">
              {status.accountLabel || "ChatGPT account"} · model {status.llmModel}
            </p>
          </div>
        ) : (
          <p className="text-sm text-teal-900/60">Not connected — agents use the API key from Settings.</p>
        )}

        {!showPasteStep ? (
          <ButtonWithHelp helpId="settings.openAiOAuthConnect">
            <button
              type="button"
              onClick={active ? onDisconnect : onConnect}
              disabled={busy}
              className={`min-h-11 w-full rounded-xl px-4 font-semibold disabled:opacity-50 sm:w-auto ${
                active
                  ? "border border-red-200 bg-red-50 text-red-900"
                  : "bg-teal-700 text-white"
              }`}
            >
              {busy ? "Working…" : active ? "Disconnect OpenAI" : "Connect OpenAI account"}
            </button>
          </ButtonWithHelp>
        ) : (
          <div className="flex flex-col gap-2 rounded-xl border border-teal-100 bg-teal-50/40 p-3 text-sm">
            <p className="font-medium text-teal-950">Paste redirect URL</p>
            <p className="text-xs text-teal-900/70">
              After signing in, copy the full URL from the popup address bar (starts with{" "}
              <code className="text-xs">http://localhost:1455</code>) and paste it below.
            </p>
            <FieldLabel helpId="settings.openAiOAuthPaste">Callback URL</FieldLabel>
            <textarea
              className="min-h-24 rounded-xl border border-teal-100 px-3 py-2 font-mono text-xs"
              placeholder="http://localhost:1455/auth/callback?code=…&state=…"
              value={pastedCallback}
              onChange={(e) => setPastedCallback(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={completePaste}
                disabled={busy}
                className="min-h-10 rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Connecting…" : "Complete connection"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowPasteStep(false);
                  setPastedCallback("");
                }}
                className="min-h-10 rounded-xl border border-teal-200 px-4 font-semibold text-teal-900"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
