/**
 * @fileoverview Modal to connect an LLM provider via OAuth (popup sign-in).
 * Purpose: Pick provider, open provider login popup; OpenAI uses paste-callback for loopback redirect.
 */

import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { FieldLabel } from "./FieldLabel.jsx";

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {(result: { provider: string, account?: string }) => void} props.onConnected
 * @param {Array<{ id: string, label: string, hint?: string, ready?: boolean, needsAppCredentials?: boolean, needsPasteCallback?: boolean, redirectUri?: string }>} props.providers
 * @param {string} props.redirectUri
 * @param {string} props.llmBaseUrl
 * @param {string} props.llmModel
 */
export function LlmOAuthModal({ open, onClose, onConnected, providers, redirectUri, llmBaseUrl, llmModel }) {
  const [providerId, setProviderId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [tenantId, setTenantId] = useState("common");
  const [pastedCallback, setPastedCallback] = useState("");
  const [showPasteStep, setShowPasteStep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const list = Array.isArray(providers) ? providers : [];
  const selected = list.find((p) => p.id === providerId) || list[0] || null;

  useEffect(() => {
    if (!open) return;
    setError("");
    setClientId("");
    setClientSecret("");
    setTenantId("common");
    setPastedCallback("");
    setShowPasteStep(false);
    if (list.length) {
      setProviderId((prev) => (prev && list.some((p) => p.id === prev) ? prev : list[0].id));
    }
  }, [open, list]);

  if (!open) return null;

  const needsCredentials = selected && selected.needsAppCredentials && !selected.ready;
  const needsPaste = selected?.needsPasteCallback === true;

  /**
   * Completes OpenAI OAuth from pasted loopback callback URL.
   */
  async function completePaste() {
    if (!pastedCallback.trim()) {
      setError("Paste the full URL from the sign-in popup address bar.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await api("/api/settings/llm/oauth/complete-paste", {
        method: "POST",
        body: JSON.stringify({ pastedInput: pastedCallback.trim() }),
      });
      onConnected({
        provider: data.provider || selected?.id || "openai",
        account: data.account || "",
      });
      onClose();
    } catch (err) {
      setError(err.detail || err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Opens provider OAuth in a popup and waits for postMessage (or paste for OpenAI).
   */
  async function onConnect() {
    if (!selected) {
      setError("Choose a provider.");
      return;
    }
    if (needsCredentials && (!clientId.trim() || !clientSecret.trim())) {
      setError("Enter OAuth Client ID and Client Secret from your provider console.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          llmAuthMode: "oauth",
          llmBaseUrl,
          llmModel,
        }),
      });

      const data = await api("/api/settings/llm/oauth/start", {
        method: "POST",
        body: JSON.stringify({
          provider: selected.id,
          popup: true,
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          tenantId: selected.id === "azure_openai" ? tenantId.trim() : undefined,
        }),
      });

      if (!data.authorizeUrl) {
        setError("No authorize URL returned.");
        return;
      }

      if (data.needsPasteCallback || needsPaste) {
        setShowPasteStep(true);
      }

      const popup = window.open(
        data.authorizeUrl,
        "yambot_llm_oauth",
        "width=520,height=720,menubar=no,toolbar=no,location=yes,status=no"
      );
      if (!popup) {
        setError("Popup blocked. Allow popups for this site and try again.");
        return;
      }

      if (data.needsPasteCallback || needsPaste) {
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
          if (msg.ok) {
            resolve(msg);
          } else {
            reject(new Error(msg.detail || "OAuth failed"));
          }
        }

        function cleanup() {
          window.clearTimeout(timeout);
          window.removeEventListener("message", onMessage);
        }

        window.addEventListener("message", onMessage);
      }).then((msg) => {
        onConnected({
          provider: msg.provider || selected.id,
          account: msg.account || "",
        });
        onClose();
      });
    } catch (err) {
      setError(err.detail || err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="llm-oauth-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-2xl border border-teal-100 bg-white p-4 shadow-xl">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 id="llm-oauth-title" className="text-lg font-semibold text-teal-950">
              Connect LLM account
            </h2>
            <p className="mt-1 text-sm text-teal-900/70">
              {selected?.id === "openai"
                ? "Sign in with your ChatGPT account. No API key or OAuth app setup needed."
                : "Choose a provider, then sign in on their website. Tokens are stored encrypted for your account."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 min-w-10 rounded-lg text-teal-700 hover:bg-teal-50"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {!showPasteStep ? (
          <fieldset className="flex flex-col gap-2">
            <FieldLabel helpId="settings.llmOAuthConnect">Provider</FieldLabel>
            <div className="grid gap-2 sm:grid-cols-1">
              {list.map((p) => (
                <label
                  key={p.id}
                  className={`flex cursor-pointer flex-col gap-1 rounded-xl border px-3 py-2 text-sm ${
                    providerId === p.id ? "border-teal-500 bg-teal-50" : "border-teal-100"
                  }`}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <input
                      type="radio"
                      name="oauthProvider"
                      checked={providerId === p.id}
                      onChange={() => setProviderId(p.id)}
                    />
                    {p.label}
                  </span>
                  {p.hint ? <span className="text-xs text-teal-900/60">{p.hint}</span> : null}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        {needsCredentials && !showPasteStep ? (
          <div className="flex flex-col gap-2 rounded-xl border border-amber-100 bg-amber-50/60 p-3 text-sm">
            <p className="font-medium text-amber-950">OAuth app credentials</p>
            <p className="text-xs text-amber-900/80">
              Create an OAuth app in your provider console and register this redirect URI:
            </p>
            <code className="break-all rounded bg-white px-2 py-1 text-xs">{redirectUri || selected?.redirectUri}</code>
            <label className="flex flex-col gap-1">
              <span>Client ID</span>
              <input
                className="min-h-10 rounded-lg border border-teal-100 px-2"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span>Client secret</span>
              <input
                className="min-h-10 rounded-lg border border-teal-100 px-2"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                autoComplete="off"
              />
            </label>
            {selected?.id === "azure_openai" ? (
              <label className="flex flex-col gap-1">
                <span>Tenant ID (optional)</span>
                <input
                  className="min-h-10 rounded-lg border border-teal-100 px-2"
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  placeholder="common"
                />
              </label>
            ) : null}
          </div>
        ) : null}

        {showPasteStep ? (
          <div className="flex flex-col gap-2 rounded-xl border border-sky-100 bg-sky-50/70 p-3 text-sm">
            <p className="font-medium text-sky-950">Finish sign-in</p>
            <ol className="list-decimal space-y-1 pl-4 text-xs text-sky-900/90">
              <li>Complete sign-in in the popup (ChatGPT / OpenAI login).</li>
              <li>
                The popup may show a connection error — that is normal. Copy the <strong>full URL</strong> from
                the popup address bar (starts with <code>http://127.0.0.1:1455/…</code>).
              </li>
              <li>Paste it below and click Complete connection.</li>
            </ol>
            <label className="flex flex-col gap-1">
              <span>Pasted redirect URL</span>
              <textarea
                className="min-h-20 rounded-lg border border-teal-100 px-2 py-1 font-mono text-xs"
                value={pastedCallback}
                onChange={(e) => setPastedCallback(e.target.value)}
                placeholder="http://127.0.0.1:1455/auth/callback?code=…&state=…"
              />
            </label>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-11 rounded-xl border border-teal-200 px-4 font-semibold text-teal-900 disabled:opacity-50"
          >
            Cancel
          </button>
          {showPasteStep ? (
            <button
              type="button"
              onClick={completePaste}
              disabled={busy}
              className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Connecting…" : "Complete connection"}
            </button>
          ) : (
            <button
              type="button"
              onClick={onConnect}
              disabled={busy || !selected}
              className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Opening sign-in…" : "Sign in (opens popup)"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
