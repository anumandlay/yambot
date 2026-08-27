/**
 * @fileoverview Process transition validation — enforce SOP stage graphs.
 * Purpose: Prevent invalid stage jumps on advance_process.
 * Downstream: worker process/advance route.
 */

/**
 * @param {object} definition - ProcessDefinition doc with stages + transitions
 * @param {string} fromStage
 * @param {string} toStage
 * @returns {{ ok: boolean, detail?: string }}
 */
export function validateProcessTransition(definition, fromStage, toStage) {
  const from = String(fromStage || "").trim();
  const to = String(toStage || "").trim();
  if (!to) return { ok: false, detail: "target stage required" };
  if (!from || from === to) return { ok: true };

  const transitions = Array.isArray(definition?.transitions) ? definition.transitions : [];
  if (!transitions.length) return { ok: true };

  const allowed = transitions.some((t) => t.from === from && t.to === to);
  if (!allowed) {
    return {
      ok: false,
      detail: `Transition ${from} → ${to} not allowed. Allowed: ${transitions.map((t) => `${t.from}→${t.to}`).join(", ")}`,
    };
  }
  return { ok: true };
}
