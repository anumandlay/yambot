/**
 * @fileoverview Agent readiness score — checklist before trusting an employee to run.
 * Purpose: Surface missing instructions, mailbox, schedule/trigger, success criteria, recent health.
 * Downstream: GET /api/agents, Command Center, CEO chat.
 */

import { publicEmailSummary } from "./agentEmail.js";

/**
 * @param {object} agent — lean or document
 * @param {{
 *   hasTrigger?: boolean,
 *   recentTasks?: { status: string }[],
 * }} [ctx]
 * @returns {{ score: number, checks: { id: string, ok: boolean, label: string }[] }}
 */
export function computeAgentReadiness(agent, ctx = {}) {
  const instructions = String(agent?.instructions || "").trim();
  const success = String(agent?.successCriteria || "").trim();
  const skill = String(agent?.skill || "").trim();
  const emailSummary = publicEmailSummary(agent);
  const mentionsEmail = /email|inbox|smtp|imap|mailbox|send_email|check_email/i.test(
    `${instructions} ${skill} ${success}`
  );
  const scheduleOn = Boolean(agent?.schedule?.enabled);
  const hasTrigger = Boolean(ctx.hasTrigger);
  const active = agent?.active !== false;
  const desiredRunning = (agent?.computer?.desired || "running") === "running";
  const now = Date.now();
  const online = Boolean(
    agent?.computer?.lastSeenAt &&
      now - new Date(agent.computer.lastSeenAt).getTime() < 45_000
  );
  const recent = Array.isArray(ctx.recentTasks) ? ctx.recentTasks : [];
  const recentDone = recent.filter((t) => t.status === "done").length;
  const recentError = recent.filter((t) => t.status === "error").length;
  const recentOk =
    recent.length === 0 ? true : recentDone >= recentError || recentDone > 0;

  /** @type {{ id: string, ok: boolean, label: string }[]} */
  const checks = [
    {
      id: "active",
      ok: active,
      label: active ? "Agent is active" : "Agent is inactive",
    },
    {
      id: "instructions",
      ok: instructions.length >= 20 || skill.length >= 10,
      label:
        instructions.length >= 20 || skill.length >= 10
          ? "Objective / instructions defined"
          : "Add standing instructions or skill text",
    },
    {
      id: "success",
      ok: success.length >= 8,
      label: success.length >= 8 ? "Success criteria defined" : "Add success criteria",
    },
    {
      id: "email",
      ok: !mentionsEmail || Boolean(emailSummary.configured),
      label: !mentionsEmail
        ? "Email not required"
        : emailSummary.configured
          ? "Mailbox configured"
          : "Mailbox required but not configured",
    },
    {
      id: "trigger",
      ok: scheduleOn || hasTrigger,
      label:
        scheduleOn || hasTrigger
          ? "Schedule or trigger attached"
          : "No schedule or trigger — agent only runs from chat",
    },
    {
      id: "computer",
      ok: !desiredRunning || online || !active,
      label: !active
        ? "Computer N/A (inactive)"
        : !desiredRunning
          ? "Computer stopped (emergency or manual)"
          : online
            ? "Cloud computer online"
            : "Cloud computer offline / starting",
    },
    {
      id: "recent_runs",
      ok: recentOk,
      label:
        recent.length === 0
          ? "No recent runs yet"
          : recentOk
            ? `Recent runs healthy (${recentDone} ok / ${recentError} fail)`
            : `Recent runs failing (${recentError} errors)`,
    },
  ];

  const okCount = checks.filter((c) => c.ok).length;
  const score = Math.round((okCount / checks.length) * 100);
  return { score, checks };
}
