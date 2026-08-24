/**
 * @fileoverview Modal for ChatGPT device-code OAuth via LiteLLM gateway.
 * Purpose: Start OAuth on YamBot API → LiteLLM proxy → poll until tokens stored.
 * Fallback: browser PKCE sign-in when OpenAI device page returns unknown_error.
 */

import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { FieldLabel } from "./FieldLabel.jsx";

const CODEX_DEVICE_URL = "https://auth.openai.com/codex/device";

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {(result: { account?: string, modelName?: string }) => void} props.onConnected
 * @param {() => void} [props.onBrowserFallback] — open YamBot Codex popup + paste flow
 * @param {string} props.llmModel — catalog model id (e.g. chatgpt/gpt-5.3-codex)
 */
export function LlmGatewayModal({ open, onClose, onConnected, onBrowserFallback, llmModel }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [userCode, setUserCode] = useState("");
  const [verificationUrl, setVerificationUrl] = useState(CODEX_DEVICE_URL);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!open) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      setError("");
      setSessionId("");
      setUserCode("");
      setVerificationUrl(CODEX_DEVICE_URL);
      return;
    }
    startOAuth();
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [open, llmModel]);

  /**
   * Begins device-code flow and polls LiteLLM via YamBot API.
   */
  async function startOAuth() {
    setBusy(true);
    setError("");
    try {
      await api("/api/settings/litellm/ensure-key", { method: "POST" });
      const data = await api("/api/settings/litellm/oauth/chatgpt/start", { method: "POST" });
      setSessionId(data.sessionId || "");
      setUserCode(data.userCode || "");
      const url = data.verificationUrl || CODEX_DEVICE_URL;
      setVerificationUrl(url);
      beginPolling(data.sessionId);
    } catch (err) {
      setError(err.detail || err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  /**
   * @param {string} sid
   */
  function beginPolling(sid) {
    if (!sid || pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const q = new URLSearchParams({ sessionId: sid, model: llmModel || "chatgpt/gpt-5.3-codex" });
        const status = await api(`/api/settings/litellm/oauth/chatgpt/status?${q}`);
        if (status.status === "success") {
          clearInterval(pollRef.current);
          pollRef.current = null;
          onConnected({ account: status.account || "", modelName: status.modelName || "" });
          onClose();
        } else if (status.status === "error" || status.status === "cancelled") {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setError(status.detail || "ChatGPT sign-in failed or was cancelled.");
        }
      } catch (err) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setError(err.detail || err.message || String(err));
      }
    }, 3000);
  }

  /**
   * Cancels in-flight OAuth when the user closes the modal.
   */
  async function handleClose() {
    if (sessionId) {
      try {
        await api("/api/settings/litellm/oauth/chatgpt/cancel", {
          method: "POST",
          body: JSON.stringify({ sessionId }),
        });
      } catch {
        // ignore
      }
    }
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    onClose();
  }

  /**
   * Switches to browser PKCE flow when device-code page errors on OpenAI's side.
   */
  function tryBrowserFallback() {
    handleClose().catch(() => onClose());
    onBrowserFallback?.();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        className="flex w-full max-w-md flex-col gap-3 rounded-2xl border border-teal-100 bg-white p-4 shadow-xl"
      >
        <h2 className="text-lg font-semibold text-teal-950">Sign in with ChatGPT</h2>
        <p className="text-sm text-teal-900/70">
          Open the Codex device page, sign in, and enter the code below. Enable device login in ChatGPT
          → Settings → Security if prompted.
        </p>

        <p className="text-sm">
          <a
            href={verificationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-teal-700 underline"
          >
            Open {CODEX_DEVICE_URL.replace("https://", "")}
          </a>
        </p>

        {userCode ? (
          <div className="rounded-xl border border-teal-100 bg-teal-50/60 p-3 text-center">
            <FieldLabel helpId="settings.litellmDeviceCode">Your code</FieldLabel>
            <p className="mt-1 font-mono text-2xl font-bold tracking-widest text-teal-900">{userCode}</p>
          </div>
        ) : null}

        {busy ? <p className="text-sm text-teal-800">Starting sign-in…</p> : null}
        {!busy && sessionId && !error ? (
          <p className="text-sm text-teal-800">Waiting for authorization…</p>
        ) : null}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}

        {onBrowserFallback ? (
          <div className="rounded-xl border border-amber-100 bg-amber-50/80 p-3 text-sm text-amber-950">
            <p className="font-semibold">OpenAI shows “Authentication Error”?</p>
            <p className="mt-1 text-amber-900/90">
              Use browser sign-in instead — popup login, then paste the redirect URL. Works when device
              codes fail on OpenAI&apos;s page.
            </p>
            <button
              type="button"
              onClick={tryBrowserFallback}
              className="mt-2 min-h-11 w-full rounded-xl border border-amber-200 bg-white px-4 font-semibold text-amber-950"
            >
              Try browser sign-in…
            </button>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => startOAuth()}
            disabled={busy}
            className="min-h-11 rounded-xl border border-teal-200 px-4 font-semibold text-teal-900 disabled:opacity-50"
          >
            New code
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
