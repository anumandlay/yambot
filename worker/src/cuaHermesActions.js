/**
 * @fileoverview Hermes-style input actions via Python cua-driver MCP sidecar.
 * Purpose: Pure driver clicks/types — no Playwright rematch, no cursor glide overlay.
 * Downstream: computerUse.js when CUA is active; agent.js computer_use case.
 */

/**
 * @param {ReturnType<import('./cuaHermesBridge.js').createCuaHermesBridge>} bridge
 */
export function createHermesCuaActions(bridge) {
  return {
    /**
     * @param {{
     *   element?: number,
     *   x?: number,
     *   y?: number,
     *   button?: string,
     * }} opts
     */
    async click(opts = {}) {
      const element = opts.element != null ? Number(opts.element) : null;
      const x = opts.x != null ? Number(opts.x) : null;
      const y = opts.y != null ? Number(opts.y) : null;
      if (element == null && (x == null || y == null)) {
        return { ok: false, error: "computer_use click requires element or x/y", computerUse: true };
      }
      const out = await bridge.call(
        "click",
        {
          element: element != null ? element : undefined,
          x: element == null ? x : undefined,
          y: element == null ? y : undefined,
          button: opts.button || "left",
        },
        25000
      );
      return {
        ok: Boolean(out?.ok),
        action: "click",
        element,
        x,
        y,
        error: out?.ok ? undefined : out?.error || "click failed",
        via: "hermes_python_mcp",
        computerUse: true,
      };
    },

    /**
     * @param {{ text: string }} opts
     */
    async typeText(opts) {
      const text = String(opts.text ?? "");
      const out = await bridge.call("type", { text }, 35000);
      return {
        ok: Boolean(out?.ok),
        action: "type",
        textLength: text.length,
        error: out?.ok ? undefined : out?.error || "type failed",
        via: "hermes_python_mcp",
        computerUse: true,
      };
    },

    /**
     * @param {{ keys: string }} opts
     */
    async key(opts) {
      const keys = String(opts.keys || "").trim();
      if (!keys) return { ok: false, error: "computer_use key requires keys", computerUse: true };
      const out = await bridge.call("key", { keys }, 20000);
      return {
        ok: Boolean(out?.ok),
        action: "key",
        keys,
        error: out?.ok ? undefined : out?.error || "key failed",
        via: "hermes_python_mcp",
        computerUse: true,
      };
    },

    /**
     * @param {{ direction?: string, amount?: number, element?: number, x?: number, y?: number }} opts
     */
    async scroll(opts = {}) {
      const out = await bridge.call(
        "scroll",
        {
          direction: opts.direction || "down",
          amount: opts.amount || 3,
          element: opts.element,
          x: opts.x,
          y: opts.y,
        },
        20000
      );
      return {
        ok: Boolean(out?.ok),
        action: "scroll",
        error: out?.ok ? undefined : out?.error || "scroll failed",
        via: "hermes_python_mcp",
        computerUse: true,
      };
    },
  };
}
