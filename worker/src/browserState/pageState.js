/**
 * @fileoverview Explicit page-state model derived from DOM observations.
 * Purpose: Tell the LLM *state* (modal open, errors, auth) — not just raw elements.
 * Downstream: format.js LLM projection, verify.js state_change detection.
 */

/**
 * Heuristic auth state from URL/title/text signals.
 * @param {object} obs
 * @returns {{ state: string, confidence: number, hints: string[] }}
 */
function detectAuthState(obs) {
  const hints = [];
  const blob = `${obs.url || ""} ${obs.title || ""} ${(obs.text || "").slice(0, 2000)}`.toLowerCase();

  if (/sign[\s-]?in|log[\s-]?in|authenticate|sso|oauth|passport|account\/login/.test(blob)) {
    hints.push("login_ui");
    return { state: "login_required", confidence: 0.7, hints };
  }
  if (/session expired|sign in again|please log in|unauthorized|401/.test(blob)) {
    hints.push("session_expired");
    return { state: "session_expired", confidence: 0.75, hints };
  }
  if (/two-factor|2fa|verification code|mfa|authenticator/.test(blob)) {
    hints.push("mfa");
    return { state: "mfa_required", confidence: 0.65, hints };
  }
  if (/sign out|log out|logout|my account|dashboard|inbox/.test(blob)) {
    hints.push("authenticated_signals");
    return { state: "authenticated", confidence: 0.55, hints };
  }
  return { state: "unknown", confidence: 0.3, hints };
}

/**
 * Extracts visible error/validation hints from observation text and interactives.
 * @param {object} obs
 * @returns {object[]}
 */
function extractErrors(obs) {
  const errors = [];
  const text = String(obs.text || "");

  const patterns = [
    /(?:^|\n)\s*([A-Za-z][^:\n]{0,40}):\s*([^\n]{8,120})/g,
    /(?:error|invalid|required|must|cannot|failed)[^.!\n]{0,80}[.!]?/gi,
  ];

  for (const re of patterns) {
    let m;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(text)) && errors.length < 8) {
      const msg = String(m[0] || m[2] || "").trim();
      if (msg.length >= 8 && !errors.some((e) => e.message === msg)) {
        errors.push({ field: m[1] ? String(m[1]).trim() : undefined, message: msg });
      }
    }
  }

  for (const el of obs.interactives || []) {
    if (el.invalid || el.ariaInvalid) {
      errors.push({
        field: el.name || el.ref,
        message: el.validationMessage || "Field is invalid",
        ref: el.ref,
      });
    }
  }

  return errors.slice(0, 8);
}

/**
 * Summarizes forms from interactives grouped by parent form hints.
 * @param {object} obs
 * @returns {object[]}
 */
function summarizeForms(obs) {
  const forms = [];
  const byForm = new Map();

  for (const el of obs.interactives || []) {
    if (!el.formId && !el.inForm) continue;
    const key = el.formId || el.formName || "form";
    if (!byForm.has(key)) {
      byForm.set(key, { id: key, name: el.formName || key, fields: [], actions: [] });
    }
    const form = byForm.get(key);
    const entry = {
      ref: el.ref,
      name: el.name,
      type: el.type || el.role,
      required: el.required || false,
      value: el.value ? String(el.value).slice(0, 80) : undefined,
    };
    if (el.role === "button" || el.type === "submit" || /submit|send|continue|sign in/i.test(el.name || "")) {
      form.actions.push(entry);
    } else {
      form.fields.push(entry);
    }
  }

  for (const form of byForm.values()) {
    if (form.fields.length || form.actions.length) forms.push(form);
  }
  return forms.slice(0, 6);
}

/**
 * Builds structured page state from a raw observation.
 * @param {object} obs - Output of observeInPage.
 * @param {{ previousUrl?: string }} [opts]
 * @returns {object}
 */
export function buildPageState(obs, opts = {}) {
  if (!obs || typeof obs !== "object") {
    return {
      page: { url: "", title: "" },
      ui: {},
      auth: { state: "unknown", confidence: 0, hints: [] },
      errors: [],
      forms: [],
      navigation: {},
    };
  }

  const openMenus = Array.isArray(obs.openMenus) ? obs.openMenus : [];
  const hints = obs.pageHints || {};

  return {
    page: {
      url: String(obs.url || ""),
      title: String(obs.title || ""),
      application: hints.application || undefined,
    },
    ui: {
      modal_open: Boolean(hints.modalOpen ?? obs.modalOpen),
      menu_open: openMenus.length > 0,
      dropdown_open: Boolean(
        hints.dropdownOpen ??
          (obs.interactives || []).some((i) => i.overlay)
      ),
      loading: Boolean(hints.loading),
      blocking_overlay: hints.blockingOverlay || undefined,
    },
    auth: detectAuthState(obs),
    captcha: obs.captcha || { present: false, signals: [] },
    errors: extractErrors(obs),
    forms: summarizeForms(obs),
    navigation: {
      previous_url: opts.previousUrl || undefined,
      current_url: String(obs.url || ""),
    },
    interactive_count: Array.isArray(obs.interactives) ? obs.interactives.length : 0,
  };
}

/**
 * Computes high-level state changes between two page states.
 * @param {object|null} before
 * @param {object|null} after
 * @returns {object}
 */
export function computeStateChange(before, after) {
  if (!before || !after) return {};
  const change = {};

  if (before.ui?.modal_open !== after.ui?.modal_open) {
    change.modal_open = { from: before.ui?.modal_open, to: after.ui?.modal_open };
  }
  if (before.ui?.menu_open !== after.ui?.menu_open) {
    change.menu_open = { from: before.ui?.menu_open, to: after.ui?.menu_open };
  }
  if (before.ui?.loading !== after.ui?.loading) {
    change.loading = { from: before.ui?.loading, to: after.ui?.loading };
  }
  if (before.navigation?.current_url !== after.navigation?.current_url) {
    change.url = {
      from: before.navigation?.current_url,
      to: after.navigation?.current_url,
    };
  }
  if ((before.errors?.length || 0) !== (after.errors?.length || 0)) {
    change.errors = { from: before.errors?.length || 0, to: after.errors?.length || 0 };
  }
  if (before.auth?.state !== after.auth?.state) {
    change.auth = { from: before.auth?.state, to: after.auth?.state };
  }

  return change;
}
