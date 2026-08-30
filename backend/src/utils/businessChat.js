/**
 * @fileoverview Interactive business-planning chat (ask for missing requirements, then emit a plan).
 * Purpose: Multi-turn plain-English setup with optional LLM profile; never create until /apply.
 * Downstream: POST /api/business/chat → BusinessSetupPage; normalizeBusinessPlan / applyBusinessPlan.
 */

import { User } from "../models/User.js";
import { LlmProfile } from "../models/LlmProfile.js";
import { resolveLlmCredentials, resolveLlmCredentialsForAgent } from "./llmCredentials.js";
import { llmChatCompletion } from "./llmChat.js";
import { normalizeBusinessPlan } from "./businessPlanFromBrief.js";

/**
 * @param {string} raw
 * @returns {object|null}
 */
function parseJsonObject(raw) {
  const text = String(raw || "").trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const brace = candidate.match(/\{[\s\S]*\}/);
    if (!brace) return null;
    try {
      return JSON.parse(brace[0]);
    } catch {
      return null;
    }
  }
}

/**
 * Resolves LLM for business planning: named profile or account Settings.
 * @param {object} user
 * @param {string} [profileId]
 */
async function resolvePlannerCreds(user, profileId) {
  const id = String(profileId || "").trim();
  if (id && id !== "settings") {
    const profile = await LlmProfile.findOne({ _id: id, user: user._id }).lean();
    if (!profile) {
      return {
        error: {
          ok: false,
          title: "LLM profile missing",
          detail: "That planning LLM was not found. Pick another profile or Settings default.",
        },
      };
    }
    const creds = await resolveLlmCredentialsForAgent(user, {
      llm: { profile: profile._id, useCustom: true },
    });
    if (!creds.apiKey) {
      return {
        error: {
          ok: false,
          title: "LLM profile has no key",
          detail: `Profile “${profile.name}” has no API key. Edit it in Settings → LLMs.`,
        },
      };
    }
    return { creds: { ...creds, profileId: String(profile._id), profileName: profile.name } };
  }
  const creds = await resolveLlmCredentials(user);
  if (!creds.apiKey) {
    return {
      error: {
        ok: false,
        title: "LLM not configured",
        detail: "Connect an LLM in Settings, or pick an LLM profile on this page.",
        hint: "Open Settings → LLM or Settings → LLMs.",
      },
    };
  }
  return { creds: { ...creds, profileId: "", profileName: "Account settings" } };
}

/**
 * @param {object} answers
 * @returns {string}
 */
function summarizeAnswersForPrompt(answers) {
  if (!answers || typeof answers !== "object") return "(none yet)";
  const lines = [];
  for (const [agentKey, bag] of Object.entries(answers)) {
    if (!bag || typeof bag !== "object") continue;
    const parts = [];
    for (const [k, v] of Object.entries(bag)) {
      const secret = /password|secret|token|apiKey|api_key/i.test(k);
      if (secret) {
        parts.push(`${k}=${String(v || "").trim() ? "(provided)" : "(missing)"}`);
      } else {
        parts.push(`${k}=${String(v || "").trim().slice(0, 120) || "(empty)"}`);
      }
    }
    lines.push(`- ${agentKey}: ${parts.join(", ")}`);
  }
  return lines.length ? lines.join("\n") : "(none yet)";
}

/**
 * @param {unknown} raw
 * @returns {{ role: string, content: string }[]}
 */
function normalizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m) => ({
      role: m?.role === "assistant" ? "assistant" : "user",
      content: String(m?.content || "").trim().slice(0, 8000),
    }))
    .filter((m) => m.content)
    .slice(-40);
}

/**
 * @param {object} parsed
 * @returns {object[]}
 */
function normalizePendingRequirements(parsed) {
  const list = Array.isArray(parsed?.pendingRequirements) ? parsed.pendingRequirements : [];
  return list.slice(0, 8).map((req, i) => {
    const fields = (Array.isArray(req?.fields) ? req.fields : []).slice(0, 12).map((f) => ({
      key: String(f?.key || "").trim().slice(0, 60),
      label: String(f?.label || f?.key || "Field").trim().slice(0, 120),
      type: String(f?.type || "text") === "password" ? "password" : "text",
      secret: Boolean(f?.secret) || String(f?.type || "") === "password",
      placeholder: String(f?.placeholder || "").trim().slice(0, 200),
      required: f?.required !== false,
    })).filter((f) => f.key);
    return {
      id: String(req?.id || `req_${i + 1}`).trim().slice(0, 80),
      agentKey: String(req?.agentKey || "").trim().slice(0, 40),
      title: String(req?.title || "Information needed").trim().slice(0, 160),
      detail: String(req?.detail || "").trim().slice(0, 800),
      fields,
    };
  }).filter((r) => r.fields.length);
}

/**
 * Merges chat-collected answers into plan agents (email + notes). Passwords stay for apply only.
 * @param {object} plan
 * @param {object} answers
 * @returns {object}
 */
export function mergeAnswersIntoPlan(plan, answers) {
  const next = normalizeBusinessPlan(plan || {});
  if (!answers || typeof answers !== "object") return next;
  for (const agent of next.agents) {
    const bag = answers[agent.key];
    if (!bag || typeof bag !== "object") continue;
    const fromAddress = String(bag.fromAddress || bag.email || "").trim();
    const smtpUser = String(bag.smtpUser || fromAddress || "").trim();
    const smtpPassword = String(bag.smtpPassword || bag.password || "").trim();
    const smtpHost = String(bag.smtpHost || "").trim();
    const imapHost = String(bag.imapHost || smtpHost || "").trim();
    if (fromAddress || smtpHost || smtpPassword) {
      agent.needsEmail = true;
      agent.email = {
        enabled: true,
        fromName: String(bag.fromName || agent.name || "").trim().slice(0, 120),
        fromAddress: fromAddress.slice(0, 200),
        smtpHost: smtpHost.slice(0, 200),
        smtpPort: Number(bag.smtpPort) || 587,
        smtpSecure: bag.smtpSecure === true || Number(bag.smtpPort) === 465,
        smtpUser: smtpUser.slice(0, 200),
        smtpPassword: smtpPassword.slice(0, 500),
        imapHost: imapHost.slice(0, 200),
        imapPort: Number(bag.imapPort) || 993,
        imapSecure: bag.imapSecure !== false,
      };
    }
    const apiKey = String(bag.apiKey || bag.api_token || "").trim();
    const apiBase = String(bag.apiBaseUrl || bag.baseUrl || "").trim();
    if (apiKey || apiBase) {
      const factLines = [];
      if (apiBase) factLines.push(`API base URL: ${apiBase}`);
      if (apiKey) factLines.push("API key: provided (use from agent secrets / facts; do not invent).");
      agent.instructions = [agent.instructions, "", ...factLines].filter(Boolean).join("\n").slice(0, 8000);
      if (apiBase) {
        try {
          const host = new URL(apiBase.includes("://") ? apiBase : `https://${apiBase}`).hostname;
          if (host && !agent.policy.httpAllowHosts.includes(host)) {
            agent.policy.httpAllowHosts.push(host);
          }
        } catch {
          /* ignore */
        }
      }
      agent.apiSecrets = { apiKey, apiBaseUrl: apiBase };
    }
  }
  return normalizeBusinessPlan(next);
}

/**
 * One turn of the business planning conversation.
 * @param {string} userId
 * @param {{ messages?: object[], profileId?: string, answers?: object }} body
 * @returns {Promise<object>}
 */
export async function chatBusinessPlan(userId, body = {}) {
  const messages = normalizeMessages(body.messages);
  if (!messages.length) {
    return {
      ok: false,
      title: "Message required",
      detail: "Send at least one message describing what you want to automate.",
    };
  }

  const user = await User.findById(userId);
  if (!user) {
    return { ok: false, title: "User missing", detail: "Could not load your account." };
  }

  const resolved = await resolvePlannerCreds(user, body.profileId);
  if (resolved.error) return resolved.error;
  const { creds } = resolved;

  const system = [
    "You are YamBot's interactive business planner. Chat until the workflow is clear, then emit a full plan.",
    "ALWAYS reply with JSON only (no markdown fences) matching:",
    "{",
    '  "assistantMessage": "what to show the user in the chat",',
    '  "status": "asking" | "ready",',
    '  "pendingRequirements": [{',
    '    "id": "outreach_email", "agentKey": "outreach", "title": "Mailbox for daily check",',
    '    "detail": "Needed so the agent can read/send mail",',
    '    "fields": [',
    '      { "key": "fromAddress", "label": "Email address", "type": "text", "secret": false },',
    '      { "key": "smtpPassword", "label": "Password or app password", "type": "password", "secret": true },',
    '      { "key": "smtpHost", "label": "SMTP host", "type": "text" },',
    '      { "key": "imapHost", "label": "IMAP host", "type": "text" }',
    "    ]",
    "  }],",
    '  "plan": null | { summary, explanation, agents, triggers, apis, setupRequired, uiMap }',
    "}",
    "",
    "Rules:",
    "- If the user says check email / send email / daily at 9am and mailbox details are missing → status=asking and pendingRequirements for email (address, password, smtp/imap hosts). Do NOT invent credentials.",
    "- If they mention an external API without base URL or auth → ask for those fields (apiBaseUrl, apiKey).",
    "- Ask only what is still missing. Check ALREADY COLLECTED ANSWERS below.",
    "- When enough is known: status=ready, pendingRequirements=[], and fill plan with precise agents/schedules/triggers/apis.",
    "- Plan agents: key, name, description, skill, profile, instructions, successCriteria, role, managedAgentKeys, schedule, policy.httpAllowHosts, needsEmail.",
    "- Triggers: name, purpose, type, agentKey, config (eventType email.replied|email.received), action enqueue_task, actionConfig.instructions.",
    "- uiMap: teach the human where to edit later. Each item: { page, routeHint, purpose, fields: [{ label, value }], relatedAgentKey }.",
    "  Examples: page \"Agents → Scheduler\", routeHint \"/agents/{id}\", fields Interval/Daily at/Scheduled goal;",
    "  page \"Operations → Triggers\", routeHint \"/operations\"; page \"Agents → Email\", routeHint \"/agents/{id}\";",
    "  page \"Agents → Policy / HTTP allow hosts\" or Policies.",
    "- explanation[] must say what you will create and why.",
    "- Prefer 1–4 agents. daily at 9am → schedule.enabled, interval daily, dailyAt 09:00 UTC unless user specifies otherwise.",
    "- assistantMessage should be clear and friendly; when asking, list what you still need.",
  ].join("\n");

  const transcript = messages
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
    .join("\n\n");

  let raw;
  try {
    raw = await llmChatCompletion({
      apiKey: creds.apiKey,
      baseUrl: creds.llmBaseUrl,
      model: creds.llmModel,
      openAiAccountId: creds.openAiAccountId || creds.oauthAccount || "",
      temperature: 0.3,
      maxTokens: 5000,
      timeoutMs: 90_000,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            "ALREADY COLLECTED ANSWERS (secrets shown as provided/missing only):",
            summarizeAnswersForPrompt(body.answers),
            "",
            "CONVERSATION:",
            transcript,
            "",
            "Respond with the JSON object now.",
          ].join("\n"),
        },
      ],
    });
  } catch (err) {
    return {
      ok: false,
      title: "Planner LLM failed",
      detail: err?.message || "Could not reach the planning LLM.",
      hint: "Check the selected LLM profile or Settings → LLM.",
    };
  }

  const parsed = parseJsonObject(raw);
  if (!parsed) {
    return {
      ok: false,
      title: "Could not parse reply",
      detail: "The planner did not return valid JSON. Send another message to retry.",
    };
  }

  const status = String(parsed.status || "").toLowerCase() === "ready" ? "ready" : "asking";
  const assistantMessage =
    String(parsed.assistantMessage || "").trim().slice(0, 4000) ||
    (status === "ready"
      ? "Here is the plan. Review it, then confirm to build."
      : "I need a bit more information before I can finalize the plan.");

  const pendingRequirements = status === "ready" ? [] : normalizePendingRequirements(parsed);

  /** @type {object|null} */
  let plan = null;
  if (status === "ready" && parsed.plan) {
    plan = mergeAnswersIntoPlan(parsed.plan, body.answers);
    if (!plan.agents.length) {
      return {
        ok: true,
        status: "asking",
        assistantMessage:
          "I could not form agents from that yet — please clarify who should do the work (and any email/API details).",
        pendingRequirements: pendingRequirements.length
          ? pendingRequirements
          : [
              {
                id: "clarify",
                agentKey: "",
                title: "Clarify the workflow",
                detail: "Describe agents and schedules again.",
                fields: [
                  {
                    key: "notes",
                    label: "More detail",
                    type: "text",
                    secret: false,
                    placeholder: "e.g. one agent checks Gmail daily…",
                    required: true,
                  },
                ],
              },
            ],
        plan: null,
        profileId: creds.profileId || "",
        profileName: creds.profileName || "",
      };
    }
  }

  return {
    ok: true,
    status: plan ? "ready" : "asking",
    assistantMessage,
    pendingRequirements: plan ? [] : pendingRequirements,
    plan,
    profileId: creds.profileId || "",
    profileName: creds.profileName || "",
  };
}
