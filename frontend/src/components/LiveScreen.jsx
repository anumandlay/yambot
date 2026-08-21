/**
 * @fileoverview Live + interactive cloud-computer screen for the YamBot dashboard.
 * Purpose: Poll screenshots; take mouse/keyboard control for CAPTCHA/recovery; pause agent until release.
 * Inputs: agentId; Downstream: `/api/agents/:id/live` + `/api/agents/:id/control`.
 */

import { useEffect, useRef, useState } from "react";
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
 * @param {{ agentId: string, compact?: boolean, className?: string }} props
 */
export function LiveScreen({ agentId, compact = false, className = "" }) {
  const [live, setLive] = useState(null);
  const [error, setError] = useState(null);
  const [controlOn, setControlOn] = useState(false);
  const [busySession, setBusySession] = useState(false);
  const [typeBuf, setTypeBuf] = useState("");
  const [status, setStatus] = useState("");
  const [zoomed, setZoomed] = useState(false);
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
          // Why: sync if another tab toggled humanControl, or after refresh.
          if (typeof data.live?.humanControl === "boolean" && !busySession) {
            setControlOn(Boolean(data.live.humanControl));
          }
        }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    }

    tick();
    const id = setInterval(tick, controlOn || zoomed ? 900 : 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [agentId, controlOn, zoomed, busySession]);

  // Why: Esc exits fullscreen so the rest of the chat stays reachable (does not release control).
  useEffect(() => {
    if (!zoomed) return undefined;
    function onKey(e) {
      if (e.key === "Escape" && !controlOnRef.current) setZoomed(false);
      else if (e.key === "Escape" && controlOnRef.current && e.target === document.body) {
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

  // Why: while controlling, capture keys on the focused stage (desktop remote feel).
  useEffect(() => {
    if (!controlOn) return undefined;
    const el = stageRef.current;
    if (!el) return undefined;

    /**
     * @param {KeyboardEvent} e
     */
    async function onKeyDown(e) {
      if (!controlOnRef.current) return;
      // Why: let Esc exit fullscreen without sending Escape to the remote page first.
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
    // Why: auto-focus so typing works immediately after Take control.
    el.focus({ preventScroll: true });
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [controlOn, agentId, zoomed]);

  if (!agentId) return null;

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
    try {
      await api(`/api/agents/${agentId}/control`, {
        method: "POST",
        body: JSON.stringify({ type: "session", active }),
      });
      setControlOn(active);
      setStatus(
        active
          ? "You have control — click & type on the screen. Agent is paused."
          : "Control returned to agent."
      );
      if (active) {
        requestAnimationFrame(() => stageRef.current?.focus({ preventScroll: true }));
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

  const shellClass = zoomed
    ? "fixed inset-0 z-50 flex flex-col overflow-auto rounded-none border-0 bg-slate-950 text-white"
    : `overflow-hidden rounded-2xl border border-teal-100 bg-slate-950 text-white shadow-sm ${className}`;

  return (
    <section className={shellClass}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2 text-xs">
        <div className="flex min-w-0 flex-wrap items-center gap-2 font-semibold tracking-wide">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              controlOn
                ? "bg-amber-400"
                : live?.online
                  ? "bg-emerald-400"
                  : provisioning
                    ? "bg-amber-400"
                    : "bg-slate-500"
            }`}
          />
          {controlOn
            ? "YOU CONTROL"
            : live?.online
              ? "LIVE"
              : provisioning
                ? "STARTING…"
                : "OFFLINE"}
          {live?.workerName ? (
            <span className="truncate font-normal text-white/60">· {live.workerName}</span>
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
            title={zoomed ? "Exit full screen (Esc)" : "Zoom to full screen"}
          >
            {zoomed ? "Exit full screen" : "Zoom in"}
          </button>
        </div>
      </div>

      {controlOn ? (
        <p className="border-b border-amber-500/40 bg-amber-950/60 px-3 py-2 text-xs text-amber-50">
          Agent paused. Click the screen, scroll with the mouse wheel, and type on your keyboard.
          When finished, press <strong>Give control back</strong>.
        </p>
      ) : null}

      {live?.provisionError ? (
        <p className="border-b border-amber-500/30 bg-amber-950/50 px-3 py-2 text-xs text-amber-100">
          Provision error: {live.provisionError}
        </p>
      ) : null}

      <div
        ref={stageRef}
        tabIndex={controlOn ? 0 : -1}
        onWheel={onWheel}
        onClick={() => {
          if (controlOn) stageRef.current?.focus({ preventScroll: true });
        }}
        className={`relative flex w-full flex-1 items-center justify-center overflow-hidden bg-black outline-none ${
          controlOn ? "ring-2 ring-inset ring-amber-400/70" : ""
        } ${
          zoomed
            ? "min-h-0"
            : compact
              ? "min-h-28 sm:min-h-40"
              : "min-h-[36vh] sm:min-h-52 md:min-h-72"
        }`}
      >
        {src ? (
          <img
            ref={imgRef}
            src={src}
            alt="Agent cloud computer screen"
            onClick={onImageClick}
            draggable={false}
            className={`block h-auto w-full bg-white object-contain select-none ${
              zoomed
                ? "max-h-[calc(100dvh-8rem)]"
                : compact
                  ? "max-h-[22vh] lg:max-h-[min(38vh,20rem)]"
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
      ) : status ? (
        <p className="border-t border-white/10 px-3 py-2 text-xs text-white/50">{status}</p>
      ) : null}

      {live?.pageUrl ? (
        <div className="truncate border-t border-white/10 px-3 py-2 text-[0.7rem] text-white/40">
          {live.pageUrl}
        </div>
      ) : null}
    </section>
  );
}
