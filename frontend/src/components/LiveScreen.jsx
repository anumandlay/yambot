/**
 * @fileoverview Live + interactive cloud-computer screen for the YamBot dashboard.
 * Purpose: Poll screenshots; optional takeover + fullscreen zoom for captchas/recovery.
 * Inputs: agentId; Downstream: `/api/agents/:id/live` + `/api/agents/:id/control`.
 */

import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";

/**
 * @param {{ agentId: string, compact?: boolean, className?: string }} props
 */
export function LiveScreen({ agentId, compact = false, className = "" }) {
  const [live, setLive] = useState(null);
  const [error, setError] = useState(null);
  const [controlOn, setControlOn] = useState(false);
  const [typeBuf, setTypeBuf] = useState("");
  const [status, setStatus] = useState("");
  const [zoomed, setZoomed] = useState(false);
  const imgRef = useRef(null);

  useEffect(() => {
    if (!agentId) return undefined;
    let cancelled = false;

    async function tick() {
      try {
        const data = await api(`/api/agents/${agentId}/live`);
        if (!cancelled) {
          setLive(data.live || null);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    }

    tick();
    const id = setInterval(tick, controlOn || zoomed ? 1200 : 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [agentId, controlOn, zoomed]);

  // Why: Esc exits fullscreen so the rest of the chat stays reachable.
  useEffect(() => {
    if (!zoomed) return undefined;
    function onKey(e) {
      if (e.key === "Escape") setZoomed(false);
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [zoomed]);

  if (!agentId) return null;

  const src =
    live?.dataBase64 && live?.mime
      ? `data:${live.mime};base64,${live.dataBase64}`
      : null;

  /**
   * @param {React.MouseEvent<HTMLImageElement>} e
   */
  async function onImageClick(e) {
    if (!controlOn || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const xNorm = (e.clientX - rect.left) / rect.width;
    const yNorm = (e.clientY - rect.top) / rect.height;
    setStatus("Sending click…");
    try {
      await api(`/api/agents/${agentId}/control`, {
        method: "POST",
        body: JSON.stringify({ type: "click", xNorm, yNorm }),
      });
      setStatus("Click queued");
    } catch (err) {
      setStatus(err.detail || err.message || "Click failed");
    }
  }

  /**
   * @param {React.FormEvent} e
   */
  async function sendType(e) {
    e.preventDefault();
    if (!controlOn || !typeBuf) return;
    setStatus("Sending text…");
    try {
      await api(`/api/agents/${agentId}/control`, {
        method: "POST",
        body: JSON.stringify({ type: "type", text: typeBuf }),
      });
      setTypeBuf("");
      setStatus("Text queued");
    } catch (err) {
      setStatus(err.detail || err.message || "Type failed");
    }
  }

  /**
   * @param {string} key
   */
  async function sendKey(key) {
    if (!controlOn) return;
    try {
      await api(`/api/agents/${agentId}/control`, {
        method: "POST",
        body: JSON.stringify({ type: "key", key }),
      });
      setStatus(`Key ${key} queued`);
    } catch (err) {
      setStatus(err.detail || err.message || "Key failed");
    }
  }

  async function sendScroll(dy) {
    if (!controlOn) return;
    try {
      await api(`/api/agents/${agentId}/control`, {
        method: "POST",
        body: JSON.stringify({ type: "scroll", dy }),
      });
    } catch {
      /* ignore */
    }
  }

  const provisioning =
    !live?.online && live?.desired === "running" && !live?.provisionError;

  const shellClass = zoomed
    ? "fixed inset-0 z-50 flex flex-col overflow-auto rounded-none border-0 bg-slate-950 text-white"
    : `overflow-hidden rounded-2xl border border-teal-100 bg-slate-950 text-white shadow-sm ${className}`;

  return (
    <section className={shellClass}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2 text-xs">
        <div className="flex min-w-0 flex-wrap items-center gap-2 font-semibold tracking-wide">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              live?.online ? "bg-emerald-400" : provisioning ? "bg-amber-400" : "bg-slate-500"
            }`}
          />
          {live?.online ? "LIVE" : provisioning ? "STARTING…" : "OFFLINE"}
          {live?.workerName ? (
            <span className="truncate font-normal text-white/60">· {live.workerName}</span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-11 items-center gap-2 font-semibold text-white/80">
            <input
              type="checkbox"
              checked={controlOn}
              onChange={(e) => setControlOn(e.target.checked)}
              disabled={!live?.online}
            />
            Take control
          </label>
          <button
            type="button"
            onClick={() => setZoomed((z) => !z)}
            className="inline-flex min-h-11 items-center rounded-xl border border-white/20 bg-white/10 px-3 text-xs font-semibold"
            aria-pressed={zoomed}
            title={zoomed ? "Exit full screen (Esc)" : "Zoom to full screen"}
          >
            {zoomed ? "Exit full screen" : "Zoom in"}
          </button>
        </div>
      </div>

      {live?.provisionError ? (
        <p className="border-b border-amber-500/30 bg-amber-950/50 px-3 py-2 text-xs text-amber-100">
          Provision error: {live.provisionError}
        </p>
      ) : null}

      <div
        className={`relative flex w-full flex-1 items-center justify-center overflow-hidden bg-black ${
          zoomed
            ? "min-h-0"
            : compact
              ? "min-h-36 sm:min-h-40"
              : "min-h-[36vh] sm:min-h-52 md:min-h-72"
        }`}
      >
        {src ? (
          <img
            ref={imgRef}
            src={src}
            alt="Agent cloud computer screen"
            onClick={onImageClick}
            className={`block h-auto w-full bg-white object-contain ${
              zoomed
                ? "max-h-[calc(100dvh-8rem)]"
                : "max-h-[42vh] sm:max-h-[50vh] md:max-h-[60vh]"
            } ${controlOn ? "cursor-crosshair touch-manipulation" : ""}`}
          />
        ) : (
          <p className="px-4 py-10 text-center text-sm text-white/60">
            {error
              ? error.detail || error.message || "Could not load live screen"
              : provisioning
                ? "Provisioning cloud computer… usually ready within 30 seconds."
                : live?.online
                  ? "Waiting for first screenshot…"
                  : live?.provisionError
                    ? `Offline — ${live.provisionError}`
                    : "Cloud computer is offline."}
          </p>
        )}
      </div>

      {controlOn ? (
        <div className="flex flex-col gap-2 border-t border-white/10 bg-slate-900 px-3 py-3">
          <p className="text-xs text-white/60">
            Click the screen to click. Type below for captchas / forms.
          </p>
          <form onSubmit={sendType} className="flex flex-col gap-2 sm:flex-row">
            <input
              className="min-h-11 flex-1 rounded-xl border border-white/10 bg-black px-3 text-sm text-white"
              value={typeBuf}
              onChange={(e) => setTypeBuf(e.target.value)}
              placeholder="Type text into the page…"
            />
            <button
              type="submit"
              className="min-h-11 w-full rounded-xl bg-teal-600 px-4 text-sm font-semibold sm:w-auto"
            >
              Send text
            </button>
          </form>
          <div className="yb-scroll-x flex gap-2 pb-1 sm:flex-wrap">
            {["Enter", "Tab", "Escape", "Backspace"].map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => sendKey(key)}
                className="inline-flex min-h-11 shrink-0 items-center rounded-xl border border-white/15 px-3 text-xs font-semibold"
              >
                {key}
              </button>
            ))}
            <button
              type="button"
              onClick={() => sendScroll(500)}
              className="inline-flex min-h-11 shrink-0 items-center rounded-xl border border-white/15 px-3 text-xs font-semibold"
            >
              Scroll down
            </button>
            <button
              type="button"
              onClick={() => sendScroll(-500)}
              className="inline-flex min-h-11 shrink-0 items-center rounded-xl border border-white/15 px-3 text-xs font-semibold"
            >
              Scroll up
            </button>
          </div>
          {status ? <p className="text-xs text-teal-200/80">{status}</p> : null}
        </div>
      ) : null}

      {live?.pageUrl ? (
        <div className="truncate border-t border-white/10 px-3 py-2 text-[0.7rem] text-white/40">
          {live.pageUrl}
        </div>
      ) : null}
    </section>
  );
}
