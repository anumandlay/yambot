/**
 * @fileoverview Live + interactive cloud-computer screen (remote-desktop style).
 * Purpose: Stream JPEG thumbnail inline; Zoom opens view-only noVNC; Take control for interactive remote desktop.
 * Inputs: agentId (+ optional attention / wallMode); Downstream: `/api/agents/:id/live|control`.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { api, isTimeoutError } from "../lib/api.js";
import { ButtonWithHelp } from "./FieldLabel.jsx";
import { FloatingChatWidget } from "./FloatingChatWidget.jsx";

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
 *   taskId?: string,
 *   demoTitle?: string,
 *   recordDemo?: boolean,
 *   chatId?: string,
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
  taskId,
  demoTitle = "Demonstration",
  recordDemo = false,
  chatId,
}) {
  const [live, setLive] = useState(null);
  const [error, setError] = useState(null);
  const [controlOn, setControlOn] = useState(false);
  const [busySession, setBusySession] = useState(false);
  const [typeBuf, setTypeBuf] = useState("");
  const [status, setStatus] = useState("");
  const [demoRecording, setDemoRecording] = useState(false);
  const [teachMode, setTeachMode] = useState(false);
  const [demoNotice, setDemoNotice] = useState(null);
  const [zoomed, setZoomed] = useState(false);
  const [viewSrc, setViewSrc] = useState("");
  const [viewError, setViewError] = useState("");
  const [openingView, setOpeningView] = useState(false);
  const [desktopSrc, setDesktopSrc] = useState("");
  const [desktopSessionKey, setDesktopSessionKey] = useState(0);
  const [desktopError, setDesktopError] = useState("");
  const desktopIframeRef = useRef(null);
  const imgRef = useRef(null);
  const stageRef = useRef(null);
  const controlOnRef = useRef(false);
  const teachModeRef = useRef(false);
  const demoIdRef = useRef(null);
  /** Last click/hover on live screen — default targets Vughy left nav. */
  const lastPointerRef = useRef({ xNorm: 0.06, yNorm: 0.55 });

  /**
   * Appends one step to the active demonstration (best-effort).
   * @param {{ observation?: string, action?: object, result?: string }} step
   */
  async function recordDemoStep(step) {
    if (!demoIdRef.current) return;
    try {
      await api("/api/skills/demos/step", {
        method: "POST",
        body: JSON.stringify({
          demoId: demoIdRef.current,
          observation: step.observation || "",
          action: step.action || {},
          result: step.result || "",
        }),
      });
    } catch {
      /* demo recording must not block control */
    }
  }

  /**
   * Payload for session toggle — server starts/finishes demo recording when teaching.
   * @param {boolean} active
   * @param {{ teachSkill?: boolean, recordDemo?: boolean }} [opts]
   * @returns {object}
   */
  function sessionControlBody(active, opts = {}) {
    const teaching = Boolean(opts.teachSkill);
    return {
      type: "session",
      active,
      taskId: taskId || null,
      demoTitle: teaching ? `Skill: ${demoTitle}` : demoTitle,
      teachSkill: teaching,
      recordDemo: teaching || opts.recordDemo === true,
    };
  }

  /**
   * @param {{ _id?: string, id?: string, title?: string, stepCount?: number }|null|undefined} demonstration
   */
  function applyDemonstrationResult(demonstration) {
    const wasTeaching = teachModeRef.current;
    teachModeRef.current = false;
    setTeachMode(false);
    if (!recordDemo && !wasTeaching) return;
    if (demonstration?._id || demonstration?.id) {
      demoIdRef.current = demonstration._id || demonstration.id;
      setDemoRecording(false);
      setDemoNotice({
        tone: "success",
        text: wasTeaching
          ? `Skill draft saved (${demonstration.stepCount ?? "?"} steps) — edit it on Skills.`
          : `Demonstration saved (${demonstration.stepCount ?? "?"} steps) — convert it to a skill on Skills.`,
        href: "/skills",
      });
      return;
    }
    demoIdRef.current = null;
    setDemoRecording(false);
    if (wasTeaching) {
      setDemoNotice({
        tone: "warn",
        text: "Teaching ended, but no skill was saved. Try Teach skill again and perform at least one click or type.",
        href: "/skills",
      });
    } else if (recordDemo) {
      setDemoNotice({
        tone: "warn",
        text: "Control released, but no demonstration was saved. Use Teach skill to record a workflow.",
        href: "/skills",
      });
    }
  }

  async function startDemoCapture() {
    setDemoNotice(null);
    setDemoRecording(true);
    setStatus("Teaching skill — perform the workflow, then Done teaching.");
  }

  /**
   * Releases human control and finalizes demo recording.
   * @param {{ fromModalClose?: boolean }} [opts]
   */
  async function releaseHumanControl(opts = {}) {
    if (!controlOnRef.current && !controlOn) return;
    setBusySession(true);
    const wasTeaching = teachModeRef.current || teachMode;
    setStatus(
      wasTeaching
        ? "Saving taught steps…"
        : opts.fromModalClose
          ? "Closing control…"
          : "Giving control back…"
    );
    setDesktopError("");
    try {
      // Why: agent extension debounces typing (~450ms) and worker drains on heartbeat —
      // wait so the last click/type is flushed into the demonstration before finish.
      if (wasTeaching) {
        await new Promise((r) => setTimeout(r, 1100));
      }
      const data = await api(`/api/agents/${agentId}/control`, {
        method: "POST",
        body: JSON.stringify(sessionControlBody(false)),
      });
      setControlOn(false);
      applyDemonstrationResult(data.demonstration);
      setDesktopSrc("");
      setDesktopSessionKey((k) => k + 1);
      if (!data.demonstration) {
        setStatus("Control returned to agent.");
      } else {
        setStatus("");
      }
      if (zoomed) await openLiveView();
    } catch (err) {
      setDemoNotice({
        tone: "error",
        text: err.detail || err.message || "Could not release control",
      });
    } finally {
      setBusySession(false);
    }
  }

  useEffect(() => {
    controlOnRef.current = controlOn;
  }, [controlOn]);

  useEffect(() => {
    if (!agentId) return undefined;
    let cancelled = false;
    let inFlight = false;

    async function tick() {
      if (inFlight) return;
      inFlight = true;
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
        // Why: idle live polls must not flash timeout banners over a still-valid last frame.
        if (!cancelled && !isTimeoutError(err)) setError(err);
      } finally {
        inFlight = false;
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
        if (controlOnRef.current) {
          void releaseHumanControl({ fromModalClose: true });
        }
        setZoomed(false);
        setViewSrc("");
        setViewError("");
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
      if (e.key === "Escape") {
        e.preventDefault();
        if (controlOnRef.current) {
          void releaseHumanControl({ fromModalClose: true });
        }
        setZoomed(false);
        setViewSrc("");
        setViewError("");
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
        await recordDemoStep({
          observation: live?.pageUrl || "",
          action: { type: "key", key },
          result: "sent",
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
   * Opens a view-only noVNC stream (Zoom) without pausing the agent.
   * @returns {Promise<boolean>}
   */
  async function openLiveView() {
    setOpeningView(true);
    setViewError("");
    try {
      const desk = await api(`/api/agents/${agentId}/desktop/session`, {
        method: "POST",
        body: JSON.stringify({ viewOnly: true }),
      });
      setViewSrc(desk.embedPath || "");
      return true;
    } catch (err) {
      setViewSrc("");
      setViewError(err.detail || err.message || "Live view unavailable");
      return false;
    } finally {
      setOpeningView(false);
    }
  }

  /**
   * Zoom toggles a full-screen live noVNC view (watch only). Take control is separate.
   */
  async function toggleZoom() {
    if (zoomed) {
      setZoomed(false);
      setViewSrc("");
      setViewError("");
      return;
    }
    setZoomed(true);
    await openLiveView();
  }

  /**
   * @param {boolean} active
   * @param {{ teachSkill?: boolean, recordDemo?: boolean }} [opts]
   */
  async function setHumanSession(active, opts = {}) {
    if (!active) {
      await releaseHumanControl();
      return;
    }
    const teaching = Boolean(opts.teachSkill);
    setBusySession(true);
    setStatus(teaching ? "Starting skill teaching…" : "Taking control…");
    setDesktopError("");
    setDemoNotice(null);
    try {
      const data = await api(`/api/agents/${agentId}/control`, {
        method: "POST",
        body: JSON.stringify(sessionControlBody(true, opts)),
      });
      setControlOn(true);
      teachModeRef.current = teaching;
      setTeachMode(teaching);
      demoIdRef.current = data.demonstration?._id || data.demonstration?.id || null;
      if (teaching && demoIdRef.current) {
        await startDemoCapture();
      }
      setViewSrc("");
      setViewError("");
      if (!zoomed) setZoomed(true);
      try {
        const desk = await api(`/api/agents/${agentId}/desktop/session`, {
          method: "POST",
          body: JSON.stringify({ viewOnly: false }),
        });
        const path = desk.embedPath || "";
        setDesktopSessionKey((k) => k + 1);
        setDesktopSrc(path);
        setStatus(
          teaching
            ? "Teaching skill — use the remote desktop; the agent Chrome extension records buttons/fields by label. Then Done teaching."
            : "Remote desktop connected — click inside the screen once, then use your mouse and keyboard."
        );
      } catch (deskErr) {
        setDesktopSrc("");
        setDesktopError(
          deskErr.detail || deskErr.message || "Desktop stream unavailable; using click map."
        );
        setStatus(
          teaching
            ? "Teaching skill (fallback click map) — desktop stream failed to open."
            : "Take control (fallback click map) — desktop stream failed to open."
        );
        requestAnimationFrame(() => stageRef.current?.focus({ preventScroll: true }));
      }
    } catch (err) {
      teachModeRef.current = false;
      setTeachMode(false);
      setDemoNotice({
        tone: "error",
        text: err.detail || err.message || (teaching ? "Could not start teaching" : "Could not take control"),
      });
    } finally {
      setBusySession(false);
    }
  }

  /** Starts teach mode: human control + demonstration capture for Skills. */
  async function startTeachSkill() {
    if (controlOn && teachMode) {
      await setHumanSession(false);
      return;
    }
    await setHumanSession(true, { teachSkill: true });
  }

  /**
   * Normalized pointer on the live screenshot (for scroll targeting).
   * @param {number} clientX
   * @param {number} clientY
   * @returns {{ xNorm: number, yNorm: number }|null}
   */
  function pointerNormFromClient(clientX, clientY) {
    const el = imgRef.current || stageRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const xNorm = (clientX - rect.left) / rect.width;
    const yNorm = (clientY - rect.top) / rect.height;
    if (!Number.isFinite(xNorm) || !Number.isFinite(yNorm)) return null;
    return {
      xNorm: Math.min(1, Math.max(0, xNorm)),
      yNorm: Math.min(1, Math.max(0, yNorm)),
    };
  }

  /** Vughy left nav — scroll targets this strip, not the whole page. */
  const MENU_POINTER = { xNorm: 0.06, yNorm: 0.55 };

  /**
   * @param {number} dy
   * @param {{ xNorm?: number, yNorm?: number }} [pointer]
   */
  async function sendScrollAt(dy, pointer) {
    if (!controlOn) return;
    const pt = pointer || lastPointerRef.current;
    try {
      await api(`/api/agents/${agentId}/control`, {
        method: "POST",
        body: JSON.stringify({
          type: "scroll",
          dy,
          xNorm: pt.xNorm,
          yNorm: pt.yNorm,
        }),
      });
    } catch {
      /* ignore */
    }
  }

  /**
   * Scroll Vughy left navigation menu (fixed x position on the sidebar).
   * @param {number} dy
   */
  async function sendMenuScroll(dy) {
    lastPointerRef.current = MENU_POINTER;
    await sendScrollAt(dy, MENU_POINTER);
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
    lastPointerRef.current = { xNorm, yNorm };
    setStatus("Sending click…");
    try {
      await api(`/api/agents/${agentId}/control`, {
        method: "POST",
        body: JSON.stringify({ type: "click", xNorm, yNorm }),
      });
      // Why: Teach skill uses the agent Chrome extension for locator-rich steps;
      // coordinate demo rows are a fallback only when not teaching.
      if (!teachModeRef.current) {
        await recordDemoStep({
          observation: live?.pageUrl || "",
          action: { type: "click", xNorm, yNorm },
          result: "sent",
        });
      }
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
    if (!controlOn || desktopSrc) return;
    e.preventDefault();
    const dy = Math.max(-1200, Math.min(1200, Math.round(e.deltaY)));
    if (!dy) return;
    const pt = pointerNormFromClient(e.clientX, e.clientY);
    if (pt) lastPointerRef.current = pt;
    try {
      await api(`/api/agents/${agentId}/control`, {
        method: "POST",
        body: JSON.stringify({
          type: "scroll",
          dy,
          xNorm: (pt || lastPointerRef.current).xNorm,
          yNorm: (pt || lastPointerRef.current).yNorm,
        }),
      });
      if (!teachModeRef.current) {
        await recordDemoStep({
          observation: live?.pageUrl || "",
          action: { type: "scroll", dy, ...(pt || lastPointerRef.current) },
          result: "sent",
        });
      }
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
      if (!teachModeRef.current) {
        await recordDemoStep({
          observation: live?.pageUrl || "",
          action: { type: "type", text: typeBuf },
          result: "sent",
        });
      }
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
      if (!teachModeRef.current) {
        await recordDemoStep({
          observation: live?.pageUrl || "",
          action: { type: "key", key },
          result: "sent",
        });
      }
      setStatus(`Key ${key}`);
    } catch (err) {
      setStatus(err.detail || err.message || "Key failed");
    }
  }

  async function sendScroll(dy) {
    await sendScrollAt(dy);
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
              : modal && viewSrc
                ? "LIVE VIEW"
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
                {controlOn ? "Full screen · control" : "Full screen · live"}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {controlOn ? (
              <button
                type="button"
                disabled={busySession || !live?.online}
                onClick={() => setHumanSession(false)}
                className={`inline-flex min-h-11 items-center rounded-xl px-3 text-xs font-bold ${
                  teachMode
                    ? "bg-violet-500 text-white"
                    : "bg-amber-500 text-slate-950"
                }`}
              >
                {teachMode ? "Done teaching" : "Give control back"}
              </button>
            ) : (
              <>
                <ButtonWithHelp helpId="chat.teachSkill">
                  <button
                    type="button"
                    disabled={busySession || !live?.online}
                    onClick={() => void startTeachSkill()}
                    className="inline-flex min-h-11 items-center rounded-xl bg-violet-600 px-3 text-xs font-bold text-white disabled:opacity-40"
                  >
                    Teach skill
                  </button>
                </ButtonWithHelp>
                <ButtonWithHelp helpId="chat.takeControl">
                  <button
                    type="button"
                    disabled={busySession || !live?.online}
                    onClick={() => setHumanSession(true)}
                    className="inline-flex min-h-11 items-center rounded-xl border border-white/20 bg-white/10 px-3 text-xs font-semibold disabled:opacity-40"
                  >
                    Take control
                  </button>
                </ButtonWithHelp>
              </>
            )}
            <button
              type="button"
              onClick={() => void toggleZoom()}
              disabled={openingView || !live?.online}
              className="inline-flex min-h-11 items-center rounded-xl border border-white/20 bg-white/10 px-3 text-xs font-semibold disabled:opacity-40"
              aria-pressed={zoomed}
              title={zoomed ? "Close live view (Esc)" : "Open live screen (real-time)"}
            >
              {openingView ? "Connecting…" : zoomed ? "Close" : "Zoom"}
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

        {modal && viewError && !controlOn && !viewSrc ? (
          <p className="shrink-0 border-b border-amber-500/40 bg-amber-950/60 px-3 py-2 text-xs text-amber-50">
            Live stream unavailable ({viewError}). Showing latest screenshot instead.
          </p>
        ) : null}

        {modal && viewSrc && !controlOn ? (
          <p className="shrink-0 border-b border-teal-500/30 bg-teal-950/50 px-3 py-2 text-xs text-teal-50">
            Watching live — the agent keeps running. Use <strong>Take control</strong> to drive the browser.
          </p>
        ) : null}

        {controlOn ? (
          <p className="shrink-0 border-b border-amber-500/40 bg-amber-950/60 px-3 py-2 text-xs text-amber-50">
            {teachMode || demoRecording ? (
              <span className="mr-2 rounded bg-violet-300 px-1.5 py-0.5 font-bold uppercase tracking-wide text-violet-950">
                Teaching skill
              </span>
            ) : null}
            {desktopSrc
              ? "Agent paused — click inside the screen on the left menu, then scroll with the mouse wheel to reach Logout."
              : "Agent paused — click the left menu once, then use Menu ↓ or scroll with the mouse wheel over the menu."}
            {desktopError ? ` (${desktopError})` : ""}
          </p>
        ) : null}

        {demoNotice ? (
          <p
            className={`shrink-0 border-b px-3 py-2 text-xs ${
              demoNotice.tone === "success"
                ? "border-emerald-500/40 bg-emerald-950/70 text-emerald-50"
                : demoNotice.tone === "warn"
                  ? "border-amber-500/40 bg-amber-950/70 text-amber-50"
                  : "border-red-500/40 bg-red-950/70 text-red-50"
            }`}
          >
            {demoNotice.text}{" "}
            {demoNotice.href ? (
              <Link to={demoNotice.href} className="font-bold underline">
                Open Skills
              </Link>
            ) : null}
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
          className={`relative flex min-h-0 w-full flex-1 items-start justify-center overflow-hidden bg-black outline-none ${
            controlOn ? "ring-2 ring-inset ring-amber-400/70" : ""
          }`}
        >
          {controlOn && desktopSrc ? (
            <iframe
              key={`desktop-${desktopSessionKey}`}
              ref={desktopIframeRef}
              title={`${agentName || "Agent"} remote desktop`}
              src={desktopSrc}
              className={`h-full w-full flex-1 border-0 bg-black ${fill ? "min-h-0" : "min-h-[16rem]"}`}
              allow="clipboard-read; clipboard-write"
              onLoad={() => {
                try {
                  desktopIframeRef.current?.contentWindow?.focus();
                } catch {
                  /* ignore */
                }
              }}
            />
          ) : modal && viewSrc && !controlOn ? (
            <iframe
              key={`view-${viewSrc}`}
              title={`${agentName || "Agent"} live screen`}
              src={viewSrc}
              className={`h-full w-full flex-1 border-0 bg-black ${fill ? "min-h-0" : "min-h-[16rem]"}`}
            />
          ) : openingView && modal ? (
            <p className="px-4 py-10 text-center text-sm text-white/60">Connecting to live screen…</p>
          ) : src ? (
            <img
              ref={modal || !zoomed ? imgRef : undefined}
              src={src}
              alt="Agent cloud computer screen (full page)"
              onClick={onImageClick}
              draggable={false}
              className={`yb-live-screen-img bg-white select-none ${
                modal ? "yb-live-screen-img--contain" : ""
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

        {controlOn && !desktopSrc ? (
          <div className="flex shrink-0 flex-col gap-2 border-t border-white/10 bg-slate-900 px-3 py-3">
            <p className="text-xs text-white/60">
              To reach Logout: click the left menu, then <strong>Menu ↓</strong> several times (or Page Down).
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
              {["Enter", "Tab", "Escape", "PageDown", "End"].map((key) => (
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
                onClick={() => sendMenuScroll(700)}
                className="inline-flex min-h-11 shrink-0 items-center rounded-xl border border-amber-400/40 bg-amber-950/40 px-3 text-xs font-semibold"
              >
                Menu ↓
              </button>
              <button
                type="button"
                onClick={() => sendMenuScroll(-700)}
                className="inline-flex min-h-11 shrink-0 items-center rounded-xl border border-white/15 px-3 text-xs font-semibold"
              >
                Menu ↑
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
  } ${fill ? "h-full min-h-0 flex-1" : ""} ${
    !fill && compact
      ? wallMode
        ? "min-h-[14rem] sm:min-h-[16rem]"
        : ""
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
            onClick={() => {
              if (controlOnRef.current) {
                void releaseHumanControl({ fromModalClose: true });
              }
              setZoomed(false);
              setViewSrc("");
              setViewError("");
            }}
          >
            <div
              className={`flex h-full max-h-[100dvh] w-full max-w-[min(96rem,100%)] flex-col overflow-hidden rounded-2xl border bg-slate-950 text-white shadow-2xl sm:max-h-[min(96dvh,100%)] ${
                showAttention ? "yb-needs-attention border-red-600" : "border-white/15"
              } relative`}
              onClick={(e) => e.stopPropagation()}
            >
              {renderBody({ modal: true })}
              {chatId ? (
                <FloatingChatWidget
                  chatId={chatId}
                  className="absolute bottom-3 right-3 z-20 sm:bottom-4 sm:right-4"
                />
              ) : null}
            </div>
          </div>,
          document.body
        )
      : null;

  function renderDemoNoticeBanner() {
    if (!demoNotice) return null;
    return (
      <p
        className={`rounded-xl border px-3 py-2 text-sm ${
          demoNotice.tone === "success"
            ? "border-emerald-200 bg-emerald-50 text-emerald-950"
            : demoNotice.tone === "warn"
              ? "border-amber-200 bg-amber-50 text-amber-950"
              : "border-red-200 bg-red-50 text-red-950"
        }`}
      >
        {demoNotice.text}{" "}
        {demoNotice.href ? (
          <Link to={demoNotice.href} className="font-bold underline">
            Open Skills →
          </Link>
        ) : null}
      </p>
    );
  }

  const demoNoticeBanner = renderDemoNoticeBanner();

  return (
    <>
      <section className={inlineShell}>
        {demoNoticeBanner ? (
          <div className="shrink-0 border-b border-white/10 px-3 py-2">{demoNoticeBanner}</div>
        ) : null}
        {zoomed ? (
          <button
            type="button"
            onClick={() => void toggleZoom()}
            className="flex min-h-[12rem] flex-1 flex-col items-center justify-center gap-2 bg-slate-900 px-4 text-sm text-white/70"
          >
            <span className="font-semibold text-white">
              {agentName ? `${agentName} — ` : ""}Live view open
            </span>
            <span className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold">
              Click to re-open · Esc to close · Teach skill or Take control
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
