/**
 * @fileoverview Hermes-parity window capture via cua-driver (SOM / AX / vision).
 * Purpose: Sticky Chrome target + numbered elements + screenshot for CUA LLM turns.
 * Downstream: computerUse.js, agent.js CUA observation builder, cuaActions.js.
 */

/**
 * @typedef {{
 *   element_index: number,
 *   role?: string,
 *   label?: string,
 *   value?: string,
 *   frame?: { x?: number, y?: number, w?: number, h?: number },
 * }} CuaElement
 */

/**
 * @typedef {{
 *   ok: boolean,
 *   pid?: number,
 *   windowId?: number,
 *   title?: string,
 *   appName?: string,
 *   elements?: CuaElement[],
 *   treeMarkdown?: string,
 *   screenshotB64?: string,
 *   width?: number,
 *   height?: number,
 *   error?: string,
 *   via?: string,
 * }} CuaCaptureResult
 */

/**
 * Creates a capture helper bound to one MCP session.
 * @param {import('./cuaMcpSession.js').CuaMcpSession} session
 */
export function createCuaCapture(session) {
  /** @type {{ pid: number, windowId: number, title: string, appName: string }|null} */
  let sticky = null;
  /** @type {Map<number, CuaElement>} */
  let lastElements = new Map();

  /**
   * @param {object} w
   * @returns {boolean}
   */
  function isChromeish(w) {
    const blob = `${w.app_name || ""} ${w.title || ""} ${w.appName || ""}`.toLowerCase();
    return /chrome|chromium|google-chrome|google chrome/.test(blob);
  }

  /**
   * @param {object[]} windows
   * @returns {object|null}
   */
  function pickWindow(windows) {
    const onScreen = windows.filter((w) => w.is_on_screen !== false && !w.off_screen);
    const pool = onScreen.length ? onScreen : windows;
    const chrome = pool.filter(isChromeish);
    const prefer = chrome.length ? chrome : pool;
    prefer.sort((a, b) => Number(b.z_index ?? b.zIndex ?? 0) - Number(a.z_index ?? a.zIndex ?? 0));
    return prefer[0] || null;
  }

  /**
   * @param {import('./cuaMcpSession.js').CuaToolResult} out
   * @returns {object[]}
   */
  function windowsFromResult(out) {
    const sc = out.structuredContent || {};
    const raw =
      sc.windows ||
      sc.items ||
      (Array.isArray(out.data) ? out.data : null) ||
      out.raw?.windows ||
      [];
    return Array.isArray(raw) ? raw : [];
  }

  /**
   * @param {import('./cuaMcpSession.js').CuaToolResult} out
   * @returns {CuaElement[]}
   */
  function elementsFromResult(out) {
    const sc = out.structuredContent || {};
    const raw = sc.elements || out.raw?.elements || [];
    if (!Array.isArray(raw)) return [];
    /** @type {CuaElement[]} */
    const els = [];
    for (const row of raw) {
      const idx = Number(row.element_index ?? row.index);
      if (!Number.isFinite(idx)) continue;
      els.push({
        element_index: idx,
        role: row.role || "",
        label: row.label || row.name || "",
        value: row.value != null ? String(row.value) : "",
        frame: row.frame || row.bounds || null,
      });
    }
    return els;
  }

  return {
    getSticky() {
      return sticky;
    },
    getElement(index) {
      return lastElements.get(Number(index)) || null;
    },
    getElements() {
      return [...lastElements.values()];
    },

    /**
     * Resolves Chrome (or frontmost) window and stores sticky target.
     * @returns {Promise<{ ok: boolean, sticky?: object, error?: string }>}
     */
    async resolveTarget() {
      const listed = await session.callTool("list_windows", { on_screen_only: true }, 20000);
      if (!listed.ok) {
        return { ok: false, error: listed.error || "list_windows failed" };
      }
      const windows = windowsFromResult(listed);
      const hit = pickWindow(windows);
      if (!hit) {
        return { ok: false, error: "no windows from cua-driver" };
      }
      sticky = {
        pid: Number(hit.pid),
        windowId: Number(hit.window_id ?? hit.windowId),
        title: String(hit.title || ""),
        appName: String(hit.app_name || hit.appName || ""),
      };
      if (!Number.isFinite(sticky.pid) || !Number.isFinite(sticky.windowId)) {
        return { ok: false, error: "invalid pid/window_id from list_windows" };
      }
      return { ok: true, sticky };
    },

    /**
     * Captures sticky window (or re-resolves) with AX elements + screenshot.
     * @param {{ mode?: "som"|"ax"|"vision", _retried?: boolean }} [opts]
     * @returns {Promise<CuaCaptureResult>}
     */
    async capture(opts = {}) {
      const mode = opts.mode || "som";
      const retried = Boolean(opts._retried);
      if (!sticky) {
        const resolved = await this.resolveTarget();
        if (!resolved.ok) return { ok: false, error: resolved.error };
      }

      // Why: on Xvfb, include_screenshot often fails (MIT-SHM Match) even when AT-SPI tree works.
      // Prefer tree for som/ax; Playwright supplies the vision image in agent.js when shot missing.
      const wantTree = mode !== "vision";
      const wantShot = mode === "vision" || mode === "som";
      const timeoutMs = mode === "vision" ? 20000 : 25000;

      let gws = await session.callTool(
        "get_window_state",
        {
          pid: sticky.pid,
          window_id: sticky.windowId,
          include_accessibility_tree: wantTree,
          include_screenshot: wantShot,
          max_elements: mode === "som" ? 400 : 800,
          max_depth: mode === "som" ? 18 : 25,
        },
        timeoutMs
      );

      // SOM with both flags failed — keep the AX tree (Hermes still useful without overlay PNG).
      if (!gws.ok && mode === "som" && !retried) {
        const treeOnly = await session.callTool(
          "get_window_state",
          {
            pid: sticky.pid,
            window_id: sticky.windowId,
            include_accessibility_tree: true,
            include_screenshot: false,
            max_elements: 400,
            max_depth: 18,
          },
          20000
        );
        if (treeOnly.ok) gws = treeOnly;
      }

      if (!gws.ok) {
        if (!retried) {
          sticky = null;
          const resolved = await this.resolveTarget();
          if (!resolved.ok) {
            return { ok: false, error: gws.error || resolved.error || "get_window_state failed" };
          }
          if (mode === "vision") {
            // Last resort: desktop-scope screenshot via set_config (Hermes full-screen lane).
            await session
              .callTool("set_config", { key: "capture_scope", value: "desktop" }, 8000)
              .catch(() => null);
            const desk = await session.callTool(
              "get_window_state",
              {
                pid: sticky.pid,
                window_id: sticky.windowId,
                include_accessibility_tree: false,
                include_screenshot: true,
                max_elements: 50,
                max_depth: 8,
              },
              20000
            );
            await session
              .callTool("set_config", { key: "capture_scope", value: "window" }, 8000)
              .catch(() => null);
            if (desk.ok) gws = desk;
            else return { ok: false, error: gws.error || desk.error || "screenshot failed", via: gws.via };
          } else {
            return this.capture({ mode: "ax", _retried: true });
          }
        } else {
          return {
            ok: false,
            error: gws.error || "get_window_state failed",
            via: gws.via,
          };
        }
      }

      if (!gws.ok) {
        return {
          ok: false,
          error: gws.error || "get_window_state failed",
          via: gws.via,
        };
      }

      const sc = gws.structuredContent || {};
      const els = elementsFromResult(gws);
      lastElements = new Map(els.map((e) => [e.element_index, e]));
      const shot = gws.images?.[0] || sc.screenshot_png_b64 || "";
      const tree =
        String(sc.tree_markdown || gws.data || "").trim() ||
        els
          .slice(0, 120)
          .map(
            (e) =>
              `[${e.element_index}] ${e.role || "?"} "${String(e.label || "").slice(0, 80)}"${
                e.value ? ` = ${String(e.value).slice(0, 40)}` : ""
              }`
          )
          .join("\n");

      return {
        ok: true,
        pid: sticky.pid,
        windowId: sticky.windowId,
        title: String(sc.window_title || sticky.title || ""),
        appName: String(sc.app_name || sticky.appName || ""),
        elements: els,
        treeMarkdown: tree,
        screenshotB64: shot ? String(shot).replace(/^data:image\/\w+;base64,/, "") : "",
        width: Number(sc.screenshot_width || sc.width || 0) || undefined,
        height: Number(sc.screenshot_height || sc.height || 0) || undefined,
        via: gws.via,
        degraded: Boolean(sc.degraded) || (wantShot && !shot),
      };
    },

    /**
     * Formats capture for the LLM user/system notes (Hermes-style SOM list).
     * @param {CuaCaptureResult} cap
     * @returns {string}
     */
    formatForPrompt(cap) {
      if (!cap?.ok) return `CUA CAPTURE FAILED: ${cap?.error || "unknown"}`;
      const head = [
        "CUA CAPTURE (cua-driver — click with computer_use action=click element=N):",
        `Window: ${cap.appName || "?"} — ${cap.title || "?"}`,
        `pid=${cap.pid} window_id=${cap.windowId} elements=${cap.elements?.length || 0}`,
      ];
      const list = (cap.elements || [])
        .slice(0, 100)
        .map((e) => {
          const lab = String(e.label || "").slice(0, 70);
          const val = e.value ? ` value=${String(e.value).slice(0, 40)}` : "";
          return `  [${e.element_index}] ${e.role || "el"} "${lab}"${val}`;
        });
      return [...head, "Elements:", ...list, cap.treeMarkdown ? `\nAX tree excerpt:\n${String(cap.treeMarkdown).slice(0, 4000)}` : ""]
        .filter(Boolean)
        .join("\n");
    },
  };
}
