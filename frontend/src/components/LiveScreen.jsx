/**
 * @fileoverview Live + interactive cloud-computer screen (remote-desktop style).
 * Purpose: Stream JPEG + Take control (click/keyboard/scroll); Zoom for full viewport.
 * Inputs: agentId (+ optional attention / wallMode); Downstream: `/api/agents/:id/live|control`.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api.js";

/**
 * Maps a browser KeyboardEvent to a Playwright key / combo string.
 * @param {KeyboardEvent} e
 * @returns {string|null}
 */
function playwrightKeyFromEvent(e) {
  const ignored = new Set(["Control", "Shift", "Alt", "Meta", "OS"]);
  if (ignored.has(e.key)) return null;

  /** @type {Record<string, string>} */
  const special = {
    " ": " ",
    Enter: "Enter",
    Tab: "Tab",
    Escape: "Escape",
    Backspace: "Backspace",
    Delete: "Delete",
    ArrowUp: "ArrowUp",
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
  };

  let key = special[e.key] || (e.key.length === 1 ? e.key : e.key);
  if (!key) return null;

  const parts = [];
  if (e.ctrlKey) parts.push("Control");
  if (e.metaKey) parts.push("Meta");
  if (e.altKey) parts.push("Alt");
  // Why: only combine Shift for non-printables (Shift+Tab); letters already encode case.
  if (e.shiftKey && (e.key.length > 1 || e.key === "Tab")) parts.push("Shift");
  if (parts.length) return `${parts.join("+")}+${key}`;
  return key;
}

/**
 * @param {{
 *   agentId: string,
 *   compact?: boolean,
 *   className?: string,
 *   fill?: boolean,
 *   agentName?: string,
 *   attention?: boolean,
 *   attentionReason?: string,
 *   wallMode?: boolean,
 * }} props
 */
export function LiveScreen({
  agentId,
  compact = false,
  className = "",
  fill = false,
  agentName = "",
  attention: attentionProp,
  attentionReason: attentionReasonProp = "",
  wallMode = false,
}) {
  const [live, setLive] = useState(null);
  const [error, setError] = useState(null);
  const [controlOn, setControlOn] = useState(false);
  const [busySession, setBusySession] = useState(false);
  const [typeBuf, setTypeBuf] = useState("");
  const [status, setStatus] = useState("");
  const [zoomed, setZoomed] = useState(false);
  const [desktopSrc, setDesktopSrc] = useState("");
  const [desktopError, setDesktopError] = useState("");
  const imgRef = useRef(null);
  const stageRef = useRef(null);
  const controlOnRef = useRef(false);

  useEffect(() => {
    controlOnRef.current = controlOn;
  }, [controlOn]);

  useEffect(() => {
    if (!agentId) return undefined;
    let cancelled = false;

    async function tick() {
      try {
        const data = await api(`/api/agents/${agentId}/live`);
        if (!cancelled) {
          setLive(data.live || null);
          setError(null);
          if (typeof data.live?.humanControl === "boolean" && !busySession) {
            setControlOn(Boolean(data.live.humanControl));
          }
        }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    }

    tick();
    const id = setInterval(tick, controlOn || zoomed ? 900 : wallMode ? 2500 : 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [agentId, controlOn, zoomed, busySession, wallMode]);

  // Why: Esc closes the zoom modal (does not release remote control).
  useEffect(() => {
    if (!zoomed) return undefined;
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        setZoomed(false);
      }
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [zoomed]);

  useEffect(() => {
    if (!controlOn) return undefined;
    // Why: noVNC iframe owns keyboard when remote desktop is connected.
    if (desktopSrc) return undefined;
    const el = stageRef.current;
    if (!el) return undefined;

    /**
     * @param {KeyboardEvent} e
     */
    async function onKeyDown(e) {
      if (!controlOnRef.current) return;
      if (e.key === "Escape" && zoomed) {
        e.preventDefault();
        setZoomed(false);
        return;
      }
      const key = playwrightKeyFromEvent(e);
      if (!key) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        await api(`/api/agents/${agentId}/control`, {
          method: "POST",
          body: JSON.stringify({ type: "key", key }),
        });
        setStatus(`Key ${key}`);
      } catch (err) {
        setStatus(err.detail || err.message || "Key failed");
      }
    }

    el.addEventListener("keydown", onKeyDown);
    el.focus({ preventScroll: true });
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [controlOn, agentId, zoomed, desktopSrc]);

  if (!agentId) return null;

  const attention =
    typeof attentionProp === "boolean"
      ? attentionProp
      : Boolean(live?.needsAttention);
  const attentionReason =
    attentionReasonProp || live?.attentionReason || "Needs your attention";

  const src =
    live?.dataBase64 && live?.mime
      ? `data:${live.mime};base64,${live.dataBase64}`
      : null;

  /**
   * @param {boolean} active
   */
  async function setHumanSession(active) {
    setBusySession(true);
    setStatus(active ? "Taking control…" : "Giving control back…");
    setDesktopError("");
    try {
      await api(`/api/agents/${agentId}/control`, {
        method: "POST",
        body: JSON.stringify({ type: "session", active }),
      });
      setControlOn(active);
      if (active) {
        if (!zoomed) setZoomed(true);
        try {
          const desk = await api(`/api/agents/${agentId}/desktop/session`, {
            method: "POST",
          });
          const path = desk.embedPath || "";
          setDesktopSrc(path);
          setStatus("Remote desktop connected — use your mouse and keyboard on the screen.");
        } catch (deskErr) {
          setDesktopSrc("");
          setDesktopError(
            deskErr.detail || deskErr.message || "Desktop stream unavailable; using click map."
          );
          setStatus("Take control (fallback click map) — desktop stream failed to open.");
          requestAnimationFrame(() => stageRef.current?.focus({ preventScroll: true }));
        }
      } else {
        setDesktopSrc("");
        setStatus("Control returned to agent.");
      }
    } catch (err) {
      setStatus(err.detail || err.message || "Could not change control");
    } finally {
      setBusySession(false);
    }
  }

  /**
   * @param {React.MouseEvent<HTMLImageElement>} e
   */
  async function onImageClick(e) {
    if (!controlOn || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const xNorm = (e.clientX - rect.left) / rect.width;
    const yNorm = (e.clientY - rect.top) / rect.height;
    if (!Number.isFinite(xNorm) || !Number.isFinite(yNorm)) {
      setStatus("Click ignored — screen not ready");
      return;
    }
    setStatus("Sending click…");
    try {
      await api(`/api/agents/${agentId}/control`, {
        method: "POST",
        body: JSON.stringify({ type: "click", xNorm, yNorm }),
      });
      setStatus("Click sent");
      stageRef.current?.focus({ preventScroll: true });
    } catch (err) {
      setStatus(err.detail || err.message || "Click failed");
    }
  }

  /**
   * @param {React.WheelEvent} e
   */
  async function onWheel(e) {
    if (!controlOn) return;
    if (!e.shiftKey) return;
    e.preventDefault();
    const dy = Math.max(-1200, Math.min(1200, Math.round(e.deltaY)));
    if (!dy) return;
    try {
      await api(`/api/agents/${agentId}/control`, {
        method: "POST",
        body: JSON.stringify({ type: "scroll", dy }),
      });
    } catch {
      /* ignore */
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
      setStatus("Text sent");
      stageRef.current?.focus({ preventScroll: true });
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
      setStatus(`Key ${key}`);
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
  const showAttention = attention && !controlOn;

  /**
   * Shared chrome for inline panel and zoom modal.
   * @param {{ modal?: boolean }} opts
   */
  function renderBody({ modal = false } = {}) {
    return (
      <>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2 text-xs">
          <div className="flex min-w-0 flex-wrap items-center gap-2 font-semibold tracking-wide">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                showAttention
                  ? "bg-red-500"
                  : controlOn
                    ? "bg-amber-400"
                    : live?.online
                      ? "bg-emerald-400"
                      : provisioning
                        ? "bg-amber-400"
                        : "bg-slate-500"
              }`}
            />
            {agentName ? (
              <span className="max-w-[10rem] truncate sm:max-w-[14rem]">{agentName}</span>
            ) : null}
            {showAttention ? (
              <span className="rounded-md bg-red-600 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-white">
                Needs you
              </span>
            ) : null}
            {controlOn
              ? "REMOTE DESKTOP"
              : live?.online
                ? "LIVE"
                : provisioning
                  ? "STARTING…"
                  : "OFFLINE"}
            {live?.workerName && !agentName ? (
              <span className="truncate font-normal text-white/60">· {live.workerName}</span>
            ) : null}
            {modal ? (
              <span className="rounded-md bg-white/10 px-2 py-0.5 font-normal text-white/70">
                Full screen
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {controlOn ? (
              <button
                type="button"
                disabled={busySession || !live?.online}
                onClick={() => setHumanSession(false)}
                className="inline-flex min-h-11 items-center rounded-xl bg-amber-500 px-3 text-xs font-bold text-slate-950"
              >
                Give control back
              </button>
            ) : (
              <button
                type="button"
                disabled={busySession || !live?.online}
                onClick={() => setHumanSession(true)}
                className="inline-flex min-h-11 items-center rounded-xl border border-white/20 bg-white/10 px-3 text-xs font-semibold disabled:opacity-40"
              >
                Take control
              </button>
            )}
            <button
              type="button"
              onClick={() => setZoomed((z) => !z)}
              className="inline-flex min-h-11 items-center rounded-xl border border-white/20 bg-white/10 px-3 text-xs font-semibold"
              aria-pressed={zoomed}
              title={zoomed ? "Close full screen (Esc)" : "Open full screen modal"}
            >
              {zoomed ? "Close" : "Zoom"}
            </button>
          </div>
        </div>

        {showAttention ? (
          <p className="shrink-0 border-b border-red-500/50 bg-red-950/70 px-3 py-2 text-xs text-red-50">
            {attentionReason.slice(0, 220)}
            {" — "}
            <strong>Take control</strong> to drive this machine (CAPTCHA, login, etc.).
          </p>
        ) : null}

        {controlOn ? (
          <p className="shrink-0 border-b border-amber-500/40 bg-amber-950/60 px-3 py-2 text-xs text-amber-50">
            {desktopSrc
              ? "Agent paused — real remote desktop (noVNC). Move your mouse and type like a local computer. When finished, press Give control back."
              : "Agent paused — fallback click map (desktop stream unavailable). Click the screenshot; Shift+wheel scrolls. Prefer Give control back when done."}
            {desktopError ? ` (${desktopError})` : ""}
          </p>
        ) : null}

        {live?.provisionError ? (
          <p className="shrink-0 border-b border-amber-500/30 bg-amber-950/50 px-3 py-2 text-xs text-amber-100">
            Provision error: {live.provisionError}
          </p>
        ) : null}

        <div
          ref={modal || !zoomed ? stageRef : undefined}
          tabIndex={controlOn && !desktopSrc ? 0 : -1}
          onWheel={desktopSrc ? undefined : onWheel}
          onClick={() => {
            if (controlOn && !desktopSrc) stageRef.current?.focus({ preventScroll: true });
          }}
          className={`relative min-h-0 w-full flex-1 overflow-auto bg-black outline-none ${
            controlOn ? "ring-2 ring-inset ring-amber-400/70" : ""
          }`}
        >
          {controlOn && desktopSrc ? (
            <iframe
              title={`${agentName || "Agent"} remote desktop`}
              src={desktopSrc}
              className="h-full min-h-[16rem] w-full flex-1 border-0 bg-black"
              allow="clipboard-read; clipboard-write"
            />
          ) : src ? (
            <img
              ref={modal || !zoomed ? imgRef : undefined}
              src={src}
              alt="Agent cloud computer screen (full page)"
              onClick={onImageClick}
              draggable={false}
              className={`mx-auto block h-auto w-full max-w-none bg-white object-top object-contain select-none ${
                controlOn ? "cursor-crosshair touch-manipulation" : ""
              }`}
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

        {controlOn && !desktopSrc ? (
          <div className="flex shrink-0 flex-col gap-2 border-t border-white/10 bg-slate-900 px-3 py-3">
            <p className="text-xs text-white/60">
              Desktop: click the screen then use your keyboard. Phone: use the box below.
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
        ) : status && modal ? (
          <p className="shrink-0 border-t border-white/10 px-3 py-2 text-xs text-white/50">{status}</p>
        ) : null}

        {/* Why: URL strip under the screen looked like a stray bar above the mobile goal box;
            keep it only in the zoom modal (wall cards already show URL outside). */}
        {modal && live?.pageUrl ? (
          <div className="shrink-0 truncate border-t border-white/10 px-3 py-2 text-[0.7rem] text-white/40">
            {live.pageUrl}
          </div>
        ) : null}
      </>
    );
  }

  // Why: when zoomed, keep a compact placeholder in-flow so layout does not jump.
  const inlineShell = `flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-slate-950 text-white shadow-sm ${
    showAttention ? "yb-needs-attention border-red-600" : "border-teal-100"
  } ${fill ? "h-full flex-1" : ""} ${
    !fill && compact
      ? wallMode
        ? "min-h-[14rem] sm:min-h-[16rem]"
        : "min-h-[28vh] lg:min-h-[min(52vh,28rem)]"
      : !fill
        ? "min-h-[40vh]"
        : ""
  } ${className}`;

  const modal =
    zoomed && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-stretch justify-center bg-black/75 p-2 sm:items-center sm:p-4 md:p-6"
            role="dialog"
            aria-modal="true"
            aria-label="Agent live screen full screen"
            onClick={() => setZoomed(false)}
          >
            <div
              className={`flex h-full max-h-[100dvh] w-full max-w-[min(96rem,100%)] flex-col overflow-hidden rounded-2xl border bg-slate-950 text-white shadow-2xl sm:max-h-[min(96dvh,100%)] ${
                showAttention ? "yb-needs-attention border-red-600" : "border-white/15"
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              {renderBody({ modal: true })}
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <section className={inlineShell}>
        {zoomed ? (
          <button
            type="button"
            onClick={() => setZoomed(true)}
            className="flex min-h-[12rem] flex-1 flex-col items-center justify-center gap-2 bg-slate-900 px-4 text-sm text-white/70"
          >
            <span className="font-semibold text-white">
              {agentName ? `${agentName} — ` : ""}Remote desktop open
            </span>
            <span className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold">
              Click to re-open · Esc to close
            </span>
          </button>
        ) : (
          renderBody({ modal: false })
        )}
      </section>
      {modal}
    </>
  );
}
