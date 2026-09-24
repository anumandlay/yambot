/**
 * @fileoverview Hermes-shaped TaskPlan planner (LLM + heuristic).
 * Purpose: goal, entities, dependsOn steps, missingSlots for compound chat asks.
 * Downstream: taskPlanRunner.js.
 */

import { looksLikeComputerThenEmailCombo } from "./computerThenEmailFollowup.js";
import { looksLikeHybridCombo } from "./comboRunner.js";
import { looksLikeScheduleManageRequest } from "./scheduleFromChat.js";
import { parseEmailRecipient } from "./composioAutoRuntime.js";
import { llmChatCompletion } from "./llmChat.js";

/**
 * @param {string} text
 * @returns {string|null}
 */
export function extractUrlOrDomain(text) {
  const raw = String(text || "");
  const url = raw.match(/\bhttps?:\/\/[^\s"'<>]+/i);
  if (url?.[0]) return url[0].replace(/[.,;)\]]+$/, "");
  const bare = raw.match(
    /\b((?:[a-z0-9-]+\.)+(?:com|org|net|io|co|ai|app|dev|info|edu|gov)(?:\/[^\s]*)?)\b/i
  );
  if (!bare?.[1]) return null;
  // Why: do not treat email domains as browse targets.
  if (new RegExp(`@${bare[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(raw)) {
    return null;
  }
  const host = bare[1].replace(/[.,;)\]]+$/, "");
  return `https://${host}`;
}

/**
 * Compound asks that need Hermes-depth planning (not pure inbox check).
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeHermesTaskPlanAsk(text) {
  const raw = String(text || "").trim();
  if (!raw || looksLikeScheduleManageRequest(raw)) return false;

  // Pure Gmail check / update — keep Composio path (no TaskPlan).
  const noAddrs = raw.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, " ");
  if (
    /\b(check|unread|inbox)\b/i.test(noAddrs) &&
    /\b(e-?mails?|mails?|gmail|inbox)\b/i.test(noAddrs) &&
    !extractUrlOrDomain(raw) &&
    !/\b(vughy|crm|notion|slack|open|visit|browse|http)\b/i.test(noAddrs)
  ) {
    return false;
  }

  if (looksLikeComputerThenEmailCombo(raw) || looksLikeHybridCombo(raw)) return true;

  const site = extractUrlOrDomain(raw);
  const wantsSend =
    /\b(send|email|e-?mail|mail)\b/i.test(raw) ||
    /\b(slack|notion)\b/i.test(raw);
  if (site && wantsSend) return true;

  if (
    /\b(open|check|see|browse|visit)\b/i.test(noAddrs) &&
    /\b(and|then)\b/i.test(raw) &&
    wantsSend
  ) {
    return true;
  }
  return false;
}

/**
 * Build a deterministic plan for URL → extract → email (the Hermes example).
 * @param {string} userText
 * @returns {object}
 */
export function heuristicTaskPlanFromText(userText) {
  const raw = String(userText || "").trim();
  const website = extractUrlOrDomain(raw);
  const recipient = parseEmailRecipient(raw) || "";
  const wantsTitle = /\btitle\b/i.test(raw) || /\b(send|email).+\b(title|it)\b/i.test(raw);
  const extract = wantsTitle ? "page title" : "page results / summary";

  /** @type {string[]} */
  const missingSlots = [];
  if (/\b(send|email|e-?mail|mail)\b/i.test(raw) && !recipient) {
    missingSlots.push("email_recipient");
  }

  /** @type {object[]} */
  const steps = [];
  if (website || looksLikeHybridCombo(raw) || looksLikeComputerThenEmailCombo(raw)) {
    const computerGoal = website
      ? `Open ${website} and capture the ${extract} in your finish summary as plain text. Include a line: Page title: …`
      : raw;
    steps.push({
      id: "s1",
      kind: "computer",
      label: website ? `Open ${website}` : "Browser step",
      userText: computerGoal,
      dependsOn: [],
      status: "pending",
    });
  }

  if (/\b(send|email|e-?mail|mail)\b/i.test(raw) || recipient) {
    const depends = steps.length ? ["s1"] : [];
    steps.push({
      id: "s2",
      kind: "send_email",
      label: recipient ? `Email ${recipient}` : "Send email",
      userText: raw,
      toolkit: "gmail",
      to: recipient,
      usePriorContent: true,
      dependsOn: depends,
      status: "pending",
    });
    steps.push({
      id: "s3",
      kind: "verify",
      label: "Verify email send",
      userText: "Verify the email was sent",
      dependsOn: ["s2"],
      status: "pending",
    });
  }

  if (/\bslack\b/i.test(raw) && !steps.some((s) => s.kind === "send_slack")) {
    const depends = steps.filter((s) => s.kind === "computer").map((s) => s.id);
    steps.push({
      id: `s${steps.length + 1}`,
      kind: "send_slack",
      label: "Slack message",
      userText: raw,
      toolkit: "slack",
      usePriorContent: true,
      dependsOn: depends.length ? depends : [],
      status: "pending",
    });
  }

  return {
    goal: raw,
    entities: {
      website: website || "",
      data_to_extract: extract,
      email_recipient: recipient || null,
      send_permission: missingSlots.includes("email_recipient")
        ? "needs_recipient"
        : "implied",
    },
    missingSlots,
    clarifyQuestion: missingSlots.includes("email_recipient")
      ? "Which email address should receive this? Reply with the address (e.g. name@domain.com)."
      : "",
    steps,
    workingState: {
      website: website || "",
      pageTitle: "",
      recipient: recipient || "",
      emailDraft: null,
      lastSendOk: null,
      lastSendDetail: "",
      // Hermes-style completion flags
      draft_created: false,
      sent: false,
      verified: false,
      // Phase 2: confirm when recipient was not in the original ask
      needsSendConfirm: missingSlots.includes("email_recipient"),
      sendConfirmed: false,
      waitingFor: null,
      sendOperationId: "",
      completedOperationIds: [],
      failureCode: "",
    },
  };
}

/**
 * Normalize LLM JSON into a TaskPlan draft.
 * @param {any} parsed
 * @param {string} userText
 * @returns {object|null}
 */
export function normalizeLlmTaskPlan(parsed, userText) {
  if (!parsed || typeof parsed !== "object") return null;
  const heuristic = heuristicTaskPlanFromText(userText);
  const goal = String(parsed.goal || userText || "").trim() || userText;
  const entities = {
    ...heuristic.entities,
    ...(parsed.entities && typeof parsed.entities === "object" ? parsed.entities : {}),
  };
  if (!entities.email_recipient) {
    entities.email_recipient = parseEmailRecipient(userText) || null;
  }
  if (!entities.website) {
    entities.website = extractUrlOrDomain(userText) || entities.website || "";
  }

  /** @type {string[]} */
  let missingSlots = Array.isArray(parsed.missingSlots)
    ? parsed.missingSlots.map((s) => String(s)).filter(Boolean)
    : [...heuristic.missingSlots];
  if (
    /\b(send|email|e-?mail|mail)\b/i.test(userText) &&
    !entities.email_recipient &&
    !missingSlots.includes("email_recipient")
  ) {
    missingSlots.push("email_recipient");
  }
  if (entities.email_recipient) {
    missingSlots = missingSlots.filter((s) => s !== "email_recipient");
  }

  const stepsIn = Array.isArray(parsed.steps) ? parsed.steps : [];
  /** @type {object[]} */
  let steps = [];
  for (let i = 0; i < stepsIn.length && i < 8; i++) {
    const s = stepsIn[i];
    if (!s || typeof s !== "object") continue;
    let kind = String(s.kind || "").toLowerCase();
    if (kind === "intent") kind = "composio";
    if (!["computer", "composio", "send_email", "send_slack", "verify", "ask_user"].includes(kind)) {
      continue;
    }
    const id = String(s.id || `s${i + 1}`).trim() || `s${i + 1}`;
    steps.push({
      id,
      kind,
      label: String(s.label || kind).trim(),
      userText: String(s.userText || s.goal || userText).trim(),
      dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.map(String) : [],
      toolkit: String(s.toolkit || "").trim(),
      specId: String(s.specId || "").trim(),
      to: String(s.to || entities.email_recipient || "").trim(),
      usePriorContent: Boolean(s.usePriorContent),
      status: "pending",
      result: "",
      error: "",
    });
  }
  if (!steps.length) steps = heuristic.steps;

  // Ensure verify after send_email
  if (steps.some((s) => s.kind === "send_email") && !steps.some((s) => s.kind === "verify")) {
    const send = steps.find((s) => s.kind === "send_email");
    steps.push({
      id: "verify_send",
      kind: "verify",
      label: "Verify email send",
      userText: "Verify the email was sent",
      dependsOn: send ? [send.id] : [],
      status: "pending",
      result: "",
      error: "",
    });
  }

  return {
    goal,
    entities,
    missingSlots,
    clarifyQuestion:
      String(parsed.clarifyQuestion || "").trim() ||
      (missingSlots.includes("email_recipient")
        ? "Which email address should receive this? Reply with the address (e.g. name@domain.com)."
        : ""),
    steps,
    workingState: {
      website: entities.website || "",
      pageTitle: "",
      recipient: entities.email_recipient || "",
      emailDraft: null,
      lastSendOk: null,
      lastSendDetail: "",
      draft_created: false,
      sent: false,
      verified: false,
      needsSendConfirm: !entities.email_recipient,
      sendConfirmed: false,
      waitingFor: null,
      sendOperationId: "",
      completedOperationIds: [],
      failureCode: "",
    },
  };
}

/**
 * LLM TaskPlan; falls back to heuristic.
 * @param {string} userText
 * @param {{ apiKey?: string, llmBaseUrl?: string, llmModel?: string, openAiAccountId?: string }|null} creds
 * @returns {Promise<object>}
 */
export async function planHermesTaskPlan(userText, creds = null) {
  const text = String(userText || "").trim();
  const fallback = heuristicTaskPlanFromText(text);
  if (!creds?.apiKey) return fallback;

  try {
    const system = [
      "You plan YamBot multi-step work. Reply JSON only.",
      "Schema:",
      '{"goal":"","entities":{"website":"","data_to_extract":"","email_recipient":null},"missingSlots":["email_recipient"],"clarifyQuestion":"","steps":[{"id":"s1","kind":"computer|composio|send_email|send_slack|verify|ask_user","label":"","userText":"","dependsOn":[],"toolkit":"","specId":"","to":"","usePriorContent":false}]}',
      "Rules:",
      "- Open/check a URL or site = computer step.",
      "- Send email via connected Gmail = send_email (not computer Gmail).",
      "- If user says send to an email but gives no address, set missingSlots to include email_recipient and do not invent an address.",
      "- check email and give me update is NOT this planner (return empty steps) — that is inbox-only.",
      "- Prefer few steps. After send_email add a verify step depending on it.",
      "- dependsOn lists prior step ids.",
    ].join("\n");

    const raw = await llmChatCompletion({
      apiKey: creds.apiKey,
      baseUrl: creds.llmBaseUrl || "",
      model: creds.llmModel || "",
      openAiAccountId: creds.openAiAccountId,
      temperature: 0,
      maxTokens: 700,
      timeoutMs: 25_000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: text },
      ],
    });
    const cleaned = String(raw || "")
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return fallback;
    const parsed = JSON.parse(m[0]);
    if (Array.isArray(parsed.steps) && parsed.steps.length === 0) {
      // LLM declined (inbox-only) — caller should not use TaskPlan.
      return { ...fallback, steps: [], declined: true };
    }
    return normalizeLlmTaskPlan(parsed, text) || fallback;
  } catch (err) {
    console.warn("[taskPlanPlanner] LLM plan failed:", err?.message || err);
    return fallback;
  }
}
