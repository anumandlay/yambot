/**
 * @fileoverview Hermes-parity input actions via cua-driver MCP (click / type / key / scroll).
 * Purpose: Element-index actions resolve to Playwright viewport hits (AT-SPI label/frame → CSS)
 * so Chrome web clicks land correctly; MCP click is last resort only. Visible cursor/overlay
 * glides before the hit so Take control shows the pointer.
 * Downstream: agent.js computer_use execute path; pairs with xCursor for visible demo glide.
 */

import {
  moveXCursorVisible,
  atspiFrameCenterToViewport,
  clickWithVisibleCursor,
  showCursorAtViewport,
} from "./xCursor.js";

/**
 * Map AT-SPI role strings to Playwright getByRole names.
 * @param {string} role
 * @returns {string|null}
 */
function playwrightRole(role) {
  const r = String(role || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  if (!r) return null;
  if (/(^| )link($| )/.test(r) || r === "hyperlink") return "link";
  if (/button|push button/.test(r)) return "button";
  if (/text(field| box)?|entry|edit|combobox/.test(r)) return "textbox";
  if (/checkbox/.test(r)) return "checkbox";
  if (/radio/.test(r)) return "radio";
  if (/tab($| )/.test(r)) return "tab";
  if (/menuitem/.test(r)) return "menuitem";
  if (/heading/.test(r)) return "heading";
  return null;
}

/**
 * @param {import('./cuaMcpSession.js').CuaMcpSession} session
 * @param {ReturnType<import('./cuaCapture.js').createCuaCapture>} capture
 */
export function createCuaActions(session, capture) {
  /**
   * @param {object} sticky
   * @param {object} extra
   */
  function targetArgs(sticky, extra = {}) {
    return {
      pid: sticky.pid,
      window_id: sticky.windowId,
      ...extra,
    };
  }

  /**
   * Resolve an AT-SPI element to a Playwright viewport point, preferring DOM role/name match.
   * Why: MCP AT-SPI element_index clicks often hit the wrong Chrome control (e.g. Notifications
   * instead of Trial expiring). Label→locator and frame→viewport are accurate for web content.
   * @param {import('playwright').Page} page
   * @param {number} elementIndex
   */
  async function resolveElementViewport(page, elementIndex) {
    const el = capture.getElement(elementIndex);
    if (!el) return null;

    const label = String(el.label || "").trim();
    const role = playwrightRole(el.role);
    if (label && page && !page.isClosed()) {
      try {
        /** @type {import('playwright').Locator|null} */
        let loc = null;
        if (role) {
          loc = page.getByRole(role, { name: label, exact: false }).first();
        }
        if (!loc) {
          loc = page.getByText(label, { exact: false }).first();
        }
        await loc.waitFor({ state: "visible", timeout: 2500 }).catch(() => null);
        const box = await loc.boundingBox().catch(() => null);
        if (box && box.width > 0 && box.height > 0) {
          return {
            x: Math.round(box.x + box.width / 2),
            y: Math.round(box.y + box.height / 2),
            screenX: undefined,
            screenY: undefined,
            ok: true,
            via: role ? "playwright_role_label" : "playwright_text_label",
            label,
            role: el.role,
          };
        }
      } catch {
        /* fall through to AT-SPI frame */
      }
    }

    const mapped = await atspiFrameCenterToViewport(page, el.frame || null);
    if (mapped?.ok) {
      return { ...mapped, via: "atspi_frame_to_viewport", label, role: el.role };
    }
    return null;
  }

  /**
   * Glide OS cursor after a CUA action (legacy MCP path).
   * @param {import('playwright').Page|null} page
   * @param {number|null} element
   * @param {number|null} x
   * @param {number|null} y
   * @param {"viewport"|"screen"} [xySpace]
   */
  async function maybeShowCursor(page, element, x, y, xySpace = "viewport") {
    try {
      if (element != null && page && !page.isClosed()) {
        const resolved = await resolveElementViewport(page, element);
        if (resolved?.ok) {
          return showCursorAtViewport(page, resolved.x, resolved.y);
        }
      }
      if (element != null) {
        const el = capture.getElement(element);
        const f = el?.frame;
        if (f && f.x != null && f.y != null) {
          const sx = Number(f.x) + Number(f.w || 0) / 2;
          const sy = Number(f.y) + Number(f.h || 0) / 2;
          if (Number.isFinite(sx) && Number.isFinite(sy)) {
            const moved = await moveXCursorVisible(sx, sy);
            return {
              cursorMoved: moved.ok,
              screenX: moved.screenX,
              screenY: moved.screenY,
              x: sx,
              y: sy,
            };
          }
        }
      }
      if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) {
        return { cursorMoved: false };
      }
      if (xySpace === "screen") {
        const moved = await moveXCursorVisible(x, y);
        return { cursorMoved: moved.ok, screenX: moved.screenX, screenY: moved.screenY, x, y };
      }
      if (page && !page.isClosed()) {
        return showCursorAtViewport(page, x, y);
      }
      const moved = await moveXCursorVisible(x, y);
      return { cursorMoved: moved.ok, screenX: moved.screenX, screenY: moved.screenY, x, y };
    } catch {
      return { cursorMoved: false };
    }
  }

  return {
    resolveElementViewport,
    elementCenterViewport: resolveElementViewport,

    /**
     * Prefer Playwright hit for element_index (label/frame). Raw x/y → caller Playwright path.
     * @param {{
     *   element?: number,
     *   x?: number,
     *   y?: number,
     *   button?: string,
     *   page?: import('playwright').Page|null,
     * }} opts
     */
    async click(opts = {}) {
      let sticky = capture.getSticky();
      if (!sticky) {
        const r = await capture.resolveTarget();
        if (!r.ok) return { ok: false, error: r.error };
        sticky = capture.getSticky();
      }
      const element = opts.element != null ? Number(opts.element) : null;
      const x = opts.x != null ? Number(opts.x) : null;
      const y = opts.y != null ? Number(opts.y) : null;
      if (element == null && (x == null || y == null)) {
        return { ok: false, error: "computer_use click requires element or x/y" };
      }

      // Why: model x/y match the Playwright viewport screenshot — MCP window coords miss.
      if (element == null) {
        return {
          ok: false,
          error: "use_playwright_viewport",
          action: "click",
          x,
          y,
          computerUse: true,
        };
      }

      const page = opts.page || null;
      if (page && !page.isClosed()) {
        const resolved = await resolveElementViewport(page, element);
        if (resolved?.ok) {
          const hit = await clickWithVisibleCursor(page, resolved.x, resolved.y, {
            delayMs: 40,
          });
          return {
            ok: true,
            action: "click",
            element,
            x: resolved.x,
            y: resolved.y,
            via: resolved.via,
            label: resolved.label,
            computerUse: true,
            cursorMoved: hit.cursorMoved,
            overlayMoved: hit.overlayMoved,
            screenX: hit.screenX,
            screenY: hit.screenY,
          };
        }
      }

      // Last resort: MCP AT-SPI click (often imprecise on Chrome web UIs).
      const args = targetArgs(sticky, {
        button: String(opts.button || "left").toLowerCase(),
        element_index: element,
      });
      // Show cursor first when we can map a frame.
      if (page && !page.isClosed()) {
        await maybeShowCursor(page, element, null, null);
      }
      const res = await session.callTool("click", args, 20000);
      const cursor = res.ok
        ? await maybeShowCursor(page, element, null, null)
        : { cursorMoved: false };
      return {
        ok: res.ok,
        action: "click",
        element,
        x,
        y,
        error: res.ok ? undefined : res.error || "click failed",
        via: res.via ? `mcp_${res.via}` : "mcp",
        computerUse: true,
        ...cursor,
      };
    },

    /**
     * @param {{ text: string, page?: import('playwright').Page|null }} opts
     */
    async typeText(opts) {
      let sticky = capture.getSticky();
      if (!sticky) {
        const r = await capture.resolveTarget();
        if (!r.ok) return { ok: false, error: r.error };
        sticky = capture.getSticky();
      }
      const text = String(opts.text ?? "");
      const page = opts.page || null;
      // Prefer Playwright keyboard when focused — MCP type often misses web inputs.
      if (page && !page.isClosed()) {
        try {
          await page.keyboard.type(text, { delay: 8 });
          return {
            ok: true,
            action: "type",
            textLength: text.length,
            via: "playwright_keyboard",
            computerUse: true,
          };
        } catch {
          /* MCP fallback */
        }
      }
      const res = await session.callTool(
        "type_text",
        targetArgs(sticky, { text }),
        30000
      );
      return {
        ok: res.ok,
        action: "type",
        textLength: text.length,
        error: res.ok ? undefined : res.error || "type_text failed",
        via: res.via,
        computerUse: true,
      };
    },

    /**
     * @param {{ keys: string }} opts
     */
    async key(opts) {
      let sticky = capture.getSticky();
      if (!sticky) {
        const r = await capture.resolveTarget();
        if (!r.ok) return { ok: false, error: r.error };
        sticky = capture.getSticky();
      }
      const keys = String(opts.keys || "").trim();
      if (!keys) return { ok: false, error: "computer_use key requires keys" };
      let res = await session.callTool("keypress", targetArgs(sticky, { keys }), 15000);
      if (!res.ok) {
        res = await session.callTool("press_key", targetArgs(sticky, { key: keys }), 15000);
      }
      if (!res.ok) {
        res = await session.callTool("key", targetArgs(sticky, { keys }), 15000);
      }
      return {
        ok: res.ok,
        action: "key",
        keys,
        error: res.ok ? undefined : res.error || "key failed",
        via: res.via,
        computerUse: true,
      };
    },

    /**
     * @param {{ direction?: string, amount?: number, element?: number, x?: number, y?: number }} opts
     */
    async scroll(opts = {}) {
      let sticky = capture.getSticky();
      if (!sticky) {
        const r = await capture.resolveTarget();
        if (!r.ok) return { ok: false, error: r.error };
        sticky = capture.getSticky();
      }
      const args = targetArgs(sticky, {
        direction: String(opts.direction || "down"),
        amount: Math.max(1, Math.min(50, Number(opts.amount) || 3)),
        ...(opts.element != null ? { element_index: Number(opts.element) } : {}),
        ...(opts.x != null && opts.y != null ? { x: Number(opts.x), y: Number(opts.y) } : {}),
      });
      const res = await session.callTool("scroll", args, 15000);
      return {
        ok: res.ok,
        action: "scroll",
        error: res.ok ? undefined : res.error || "scroll failed",
        via: res.via,
        computerUse: true,
      };
    },
  };
}
