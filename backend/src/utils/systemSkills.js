/**
 * @fileoverview Built-in (system) skill templates shown on the Skills page.
 * Purpose: Document the worker’s always-on skill hints (login, shopping, email, research)
 * so operators see them next to their own library. Runtime matching still lives in
 * `worker/src/browserState/skills.js` — keep labels/steps aligned when editing either side.
 * Downstream: GET /api/skills → SkillsPage “System skills” section.
 */

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   description: string,
 *   triggers: string[],
 *   steps: string[],
 *   hints: string[],
 * }} SystemSkill
 */

/** @type {SystemSkill[]} */
export const SYSTEM_SKILLS = [
  {
    id: "login",
    label: "Login / authentication",
    description:
      "Built into every cloud worker. Auto-activates when the goal or URL looks like a sign-in flow.",
    triggers: ["log in / sign in / authenticate / SSO / password", "/login /signin /auth"],
    steps: [
      "Navigate to login page if not already there",
      "Batch type email/username then password (do not use fill_form)",
      "Click Sign in / Continue (ask_user if askBeforeLogin)",
      "Act on the next snapshot after submit (do not invent wait_for text)",
    ],
    hints: [
      "Use one actions batch: type email → type password → click Sign in.",
      "If MFA appears, use ask_user or check_email for the code.",
      "Do not loop re-entering credentials after a failed attempt — read errors first.",
    ],
  },
  {
    id: "shopping",
    label: "Shopping / checkout",
    description:
      "Built into every cloud worker. Auto-activates for cart, checkout, and purchase goals.",
    triggers: ["cart / checkout / buy / purchase / add to cart / basket"],
    steps: [
      "Open cart/basket from header icon or /cart URL on same host",
      "Review items; proceed to checkout",
      "Type shipping/payment fields in one batch only when autonomy allows",
      "ask_user before final purchase/submit",
    ],
    hints: [
      "Open Cart/Basket FIRST — do not browse unrelated products.",
      "Use dismiss_dialog for cookie banners and promo modals.",
      "Stop at payment boundary unless user explicitly authorized purchase.",
    ],
  },
  {
    id: "email",
    label: "Email compose / inbox",
    description:
      "Built into every cloud worker. Auto-activates for Gmail/Outlook compose and inbox work.",
    triggers: ["gmail / outlook / compose / inbox / send email / reply"],
    steps: [
      "Open compose or reply",
      "Batch type To/Subject/Body (contenteditable body uses type)",
      "ask_user before Send if askBeforeSubmit",
    ],
    hints: [
      "Prefer send_email action when SMTP identity is configured.",
      "Gmail body is contenteditable — use type on Message body ref.",
      "check_email for verification codes before ask_user.",
    ],
  },
  {
    id: "research",
    label: "Web research",
    description:
      "Built into every cloud worker. Auto-activates for research, compare, find, and summarize goals.",
    triggers: ["research / compare / find / list / summarize / review sites"],
    steps: [
      "Open promising result links",
      "extract key facts per page",
      "finish with structured summary + URLs",
    ],
    hints: [
      "Extract before navigating away from a useful page.",
      "Use open_tab for parallel comparison when helpful.",
    ],
  },
];

/**
 * Public list for the Skills UI (read-only system catalog).
 * @returns {SystemSkill[]}
 */
export function listSystemSkills() {
  return SYSTEM_SKILLS.map((s) => ({ ...s }));
}
