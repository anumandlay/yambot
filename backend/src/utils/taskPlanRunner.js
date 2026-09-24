/**
 * @fileoverview TaskPlan runner — clarify, execute steps, resume after computer.
 * Purpose: Hermes-depth flow for compound chat (site → extract → email + verify).
 * Downstream: chatAutoTurn.js, worker.js complete, chats.js Task link.
 */

import { TaskPlan } from "../models/TaskPlan.js";
import { Message } from "../models/Chat.js";
import {
  looksLikeHermesTaskPlanAsk,
  planHermesTaskPlan,
  heuristicTaskPlanFromText,
} from "./taskPlanPlanner.js";
import {
  buildComposioExecuteLookupFromAgent,
} from "./comboRunner.js";
import {
  runComposioMultiStep,
  parseEmailRecipient,
  matchComposioIntent,
  runComposioIntentExecute,
  COMPOSIO_INTENT_SPECS,
} from "./composioAutoRuntime.js";
import {
  decryptAgentComposioApiKey,
  expandComposioToolkitSlugs,
} from "./composioService.js";

/**
 * @param {object} planDoc
 * @returns {object[]}
 */
function readySteps(planDoc) {
  const steps = Array.isArray(planDoc.steps) ? planDoc.steps : [];
  const done = new Set(steps.filter((s) => s.status === "done").map((s) => s.id));
  return steps.filter((s) => {
    if (s.status !== "pending" && s.status !== "ready") return false;
    const deps = Array.isArray(s.dependsOn) ? s.dependsOn : [];
    return deps.every((d) => done.has(d));
  });
}

/**
 * @param {import('mongoose').Document} plan
 */
async function savePlan(plan) {
  plan.markModified("steps");
  plan.markModified("entities");
  plan.markModified("workingState");
  plan.markModified("missingSlots");
  await plan.save();
}

/**
 * Fill slots from a short user reply (email address, yes, etc.).
 * @param {import('mongoose').Document} plan
 * @param {string} userText
 * @returns {boolean} true if something useful was applied
 */
export function applyClarifyAnswerToPlan(plan, userText) {
  const text = String(userText || "").trim();
  if (!text || !plan) return false;
  let changed = false;
  const email = parseEmailRecipient(text);
  if (email) {
    plan.entities = plan.entities || {};
    plan.entities.email_recipient = email;
    plan.workingState = plan.workingState || {};
    plan.workingState.recipient = email;
    plan.missingSlots = (plan.missingSlots || []).filter((s) => s !== "email_recipient");
    for (const s of plan.steps || []) {
      if (s.kind === "send_email") {
        s.to = email;
        s.label = `Email ${email}`;
      }
    }
    changed = true;
  }
  return changed;
}

/**
 * Find an active waiting_user plan for this chat/agent.
 * @param {{ userId: string, chatId: string, agentId: string }} opts
 */
export async function findWaitingTaskPlan(opts) {
  return TaskPlan.findOne({
    user: opts.userId,
    chat: opts.chatId,
    agent: opts.agentId,
    status: "waiting_user",
  }).sort({ updatedAt: -1 });
}

/**
 * Enrich computer goal from plan step + working state instructions.
 * @param {object} step
 * @param {object} plan
 * @returns {string}
 */
export function computerGoalFromPlanStep(step, plan) {
  const base = String(step.userText || plan.goal || "").trim();
  if (/MULTI-STEP JOB|TaskPlan/i.test(base)) return base;
  return `${base}

MULTI-STEP JOB (browser does this step only):
1) Complete the site work. Capture important results in the finish summary as plain text.
2) If extracting a title, include: Page title: …
3) Do NOT send email / open Gmail / Slack / Notion in the browser — later steps use connected apps.`;
}

/**
 * Extract page title / summary into workingState from computer summary.
 * @param {object} workingState
 * @param {string} summary
 */
export function mergeComputerSummaryIntoWorkingState(workingState, summary) {
  const ws = workingState && typeof workingState === "object" ? { ...workingState } : {};
  const s = String(summary || "");
  const titled =
    s.match(/\bpage\s*titles?\s*[:=]\s*(.+)$/im)?.[1]?.trim() ||
    s.match(/\btitle\s*[:=]\s*(.+)$/im)?.[1]?.trim() ||
    "";
  if (titled) ws.pageTitle = titled.replace(/^['"]|['"]$/g, "").slice(0, 300);
  ws.lastComputerSummary = s.slice(0, 6000);
  if (!ws.pageTitle) {
    // Fallback: first non-empty line
    const line = s.split(/\n/).map((l) => l.trim()).find((l) => l.length > 2 && l.length < 200);
    if (line && !/^done\.?$/i.test(line)) ws.pageTitle = line.slice(0, 300);
  }
  return ws;
}

/**
 * Build email body from working state.
 * @param {object} plan
 * @returns {{ subject: string, body: string }}
 */
function buildEmailFromWorkingState(plan) {
  const ws = plan.workingState || {};
  const title = ws.pageTitle || "Update from YamBot";
  const site = ws.website || plan.entities?.website || "";
  const subject = site ? `Title from ${site.replace(/^https?:\/\//, "")}` : "Update from YamBot";
  const body = [
    site ? `The title of ${site} is: ${title}` : `Result: ${title}`,
    "",
    ws.lastComputerSummary
      ? `---\nComputer summary:\n${String(ws.lastComputerSummary).slice(0, 3500)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { subject, body };
}

/**
 * Start or resume a Hermes TaskPlan for a chat turn.
 * @param {{
 *   userId: string,
 *   chatId: string,
 *   agent: object,
 *   userText: string,
 *   creds?: object|null,
 * }} opts
 * @returns {Promise<{
 *   handled: boolean,
 *   action?: "reply"|"queue_goal",
 *   content?: string,
 *   goal?: string,
 *   ack?: string,
 *   reason?: string,
 *   taskPlanId?: string,
 * }>}
 */
export async function startOrResumeTaskPlan(opts) {
  const userId = String(opts.userId || "");
  const chatId = String(opts.chatId || "");
  const agent = opts.agent;
  const userText = String(opts.userText || "").trim();
  if (!userId || !chatId || !agent?._id || !userText) {
    return { handled: false };
  }

  // Resume waiting plan on clarify answers (email, short replies).
  const waiting = await findWaitingTaskPlan({
    userId,
    chatId,
    agentId: String(agent._id),
  });
  if (waiting) {
    const applied = applyClarifyAnswerToPlan(waiting, userText);
    const looksLikeAnswer =
      applied ||
      parseEmailRecipient(userText) ||
      /^(yes|ok|okay|send\s*it|go\s*ahead)\b/i.test(userText);
    if (looksLikeAnswer) {
      if (!applied && waiting.missingSlots?.includes("email_recipient")) {
        return {
          handled: true,
          action: "reply",
          content:
            waiting.clarifyQuestion ||
            "Please reply with the recipient email address (e.g. name@domain.com).",
          reason: "taskplan_still_missing_recipient",
          taskPlanId: String(waiting._id),
        };
      }
      waiting.status = "running";
      waiting.clarifyQuestion = "";
      await savePlan(waiting);
      return advanceTaskPlan({
        plan: waiting,
        agent,
        userId,
        chatId,
      });
    }
    // New unrelated ask — cancel waiting plan and continue normal routing.
    if (looksLikeHermesTaskPlanAsk(userText) || userText.length > 40) {
      waiting.status = "cancelled";
      waiting.lastError = "superseded";
      await savePlan(waiting);
    } else {
      return {
        handled: true,
        action: "reply",
        content:
          waiting.clarifyQuestion ||
          "I’m waiting on a detail for the previous multi-step job. Reply with the email address, or send a new full request.",
        reason: "taskplan_waiting_user",
        taskPlanId: String(waiting._id),
      };
    }
  }

  if (!looksLikeHermesTaskPlanAsk(userText)) {
    return { handled: false };
  }

  const draft = await planHermesTaskPlan(userText, opts.creds || null);
  if (draft.declined || !draft.steps?.length) {
    return { handled: false };
  }

  const plan = await TaskPlan.create({
    user: userId,
    chat: chatId,
    agent: agent._id,
    goal: draft.goal || userText,
    status: "planning",
    entities: draft.entities || {},
    missingSlots: draft.missingSlots || [],
    clarifyQuestion: draft.clarifyQuestion || "",
    steps: draft.steps,
    workingState: draft.workingState || {},
  });

  if (plan.missingSlots?.length) {
    plan.status = "waiting_user";
    await savePlan(plan);
    return {
      handled: true,
      action: "reply",
      content:
        plan.clarifyQuestion ||
        `I need more information before continuing: ${plan.missingSlots.join(", ")}.`,
      reason: "taskplan_clarify",
      taskPlanId: String(plan._id),
    };
  }

  plan.status = "running";
  await savePlan(plan);
  return advanceTaskPlan({ plan, agent, userId, chatId });
}

/**
 * Execute ready steps until blocked on computer or done.
 * @param {{
 *   plan: import('mongoose').Document,
 *   agent: object,
 *   userId: string,
 *   chatId: string,
 * }} opts
 */
export async function advanceTaskPlan(opts) {
  const { plan, agent, userId, chatId } = opts;
  const apiKey = decryptAgentComposioApiKey(agent);

  for (;;) {
    const ready = readySteps(plan);
    if (!ready.length) {
      const pending = (plan.steps || []).some((s) =>
        ["pending", "ready", "running"].includes(s.status)
      );
      if (!pending) {
        plan.status = "done";
        await savePlan(plan);
        const summary = formatPlanDoneMessage(plan);
        await Message.create({
          chat: chatId,
          role: "assistant",
          content: summary,
          meta: { kind: "taskplan_done", taskPlanId: String(plan._id), success: true },
        }).catch(() => null);
        return {
          handled: true,
          action: "reply",
          content: summary,
          reason: "taskplan_done",
          taskPlanId: String(plan._id),
        };
      }
      // Waiting on running computer step
      return {
        handled: true,
        action: "reply",
        content: "Multi-step job is in progress…",
        reason: "taskplan_waiting_computer",
        taskPlanId: String(plan._id),
      };
    }

    // Prefer one computer step at a time (queue and pause).
    const computer = ready.find((s) => s.kind === "computer");
    if (computer) {
      computer.status = "running";
      plan.activeTaskId = null;
      await savePlan(plan);
      const goal = computerGoalFromPlanStep(computer, plan);
      return {
        handled: true,
        action: "queue_goal",
        goal,
        content: "",
        ack: `On it — ${computer.label || "browser step"} (multi-step plan).`,
        reason: "taskplan_computer",
        taskPlanId: String(plan._id),
        taskPlanStepId: computer.id,
      };
    }

    const step = ready[0];
    step.status = "running";
    await savePlan(plan);

    if (step.kind === "ask_user") {
      plan.status = "waiting_user";
      plan.clarifyQuestion = step.userText || plan.clarifyQuestion;
      step.status = "pending";
      await savePlan(plan);
      return {
        handled: true,
        action: "reply",
        content: plan.clarifyQuestion || "Need a bit more information to continue.",
        reason: "taskplan_ask_user",
        taskPlanId: String(plan._id),
      };
    }

    if (step.kind === "send_email") {
      const to =
        String(step.to || plan.workingState?.recipient || plan.entities?.email_recipient || "").trim();
      if (!to) {
        plan.missingSlots = ["email_recipient"];
        plan.status = "waiting_user";
        plan.clarifyQuestion =
          "Which email address should receive this? Reply with the address.";
        step.status = "pending";
        await savePlan(plan);
        return {
          handled: true,
          action: "reply",
          content: plan.clarifyQuestion,
          reason: "taskplan_clarify",
          taskPlanId: String(plan._id),
        };
      }
      if (!agent.composio?.enabled || !apiKey) {
        step.status = "error";
        step.error = "Composio/Gmail not configured";
        plan.status = "error";
        plan.lastError = step.error;
        await savePlan(plan);
        return {
          handled: true,
          action: "reply",
          content:
            "I have the page result, but Composio Gmail is not enabled on this agent — enable it under Agents → Composio.",
          reason: "taskplan_composio_off",
          taskPlanId: String(plan._id),
        };
      }
      const { subject, body } = buildEmailFromWorkingState(plan);
      plan.workingState = plan.workingState || {};
      plan.workingState.emailDraft = { subject, body, to };
      const {
        composioExecuteTool,
      } = await import("./composioService.js");
      const toolkitSlugs = expandComposioToolkitSlugs(
        Array.isArray(agent.composio?.toolkitSlugs) ? agent.composio.toolkitSlugs : []
      );
      const send = await composioExecuteTool({
        userId,
        apiKey,
        sessionId: String(agent.composio?.sessionId || "").trim() || null,
        toolkitSlugs,
        tool: "GMAIL_SEND_EMAIL",
        arguments: {
          recipient_email: to,
          recipientEmail: to,
          to,
          subject,
          body,
          message_body: body,
          messageBody: body,
          is_html: false,
        },
      });
      if (send.sessionId && String(agent.composio?.sessionId || "") !== send.sessionId) {
        try {
          agent.composio = agent.composio || {};
          agent.composio.sessionId = send.sessionId;
          agent.markModified?.("composio");
          await agent.save?.();
        } catch {
          /* non-fatal */
        }
      }
      step.result = send.ok
        ? `Emailed ${to} — ${subject}`
        : String(send.error || "send failed");
      step.status = send.ok ? "done" : "error";
      step.error = send.ok ? "" : step.result;
      plan.workingState.lastSendOk = Boolean(send.ok);
      plan.workingState.lastSendDetail = step.result.slice(0, 1000);
      plan.workingState.lastSendTo = to;
      plan.workingState.lastSendSubject = subject;
      await savePlan(plan);
      if (!send.ok) {
        plan.status = "error";
        plan.lastError = step.error;
        await savePlan(plan);
        return {
          handled: true,
          action: "reply",
          content: `Email step failed: ${step.error}`,
          reason: "taskplan_email_error",
          taskPlanId: String(plan._id),
        };
      }
      continue;
    }

    if (step.kind === "send_slack" || step.kind === "composio") {
      if (!agent.composio?.enabled || !apiKey) {
        step.status = "error";
        step.error = "Composio off";
        plan.status = "error";
        await savePlan(plan);
        return {
          handled: true,
          action: "reply",
          content: "Composio is not enabled for the next connected-app step.",
          reason: "taskplan_composio_off",
          taskPlanId: String(plan._id),
        };
      }
      const executeLookup = buildComposioExecuteLookupFromAgent({ userId, agent });
      const runtime = {
        userId,
        composioApiKey: apiKey,
        composioEnabled: true,
        composioToolkitSlugs: expandComposioToolkitSlugs(
          Array.isArray(agent.composio?.toolkitSlugs) ? agent.composio.toolkitSlugs : []
        ),
        composioSessionId: String(agent.composio?.sessionId || "").trim() || null,
      };
      const prior =
        plan.workingState?.lastComputerSummary ||
        plan.workingState?.pageTitle ||
        "";
      if (step.kind === "send_slack") {
        const multi = await runComposioMultiStep({
          runtime,
          userText: step.userText || plan.goal,
          plan: [
            {
              kind: "send_slack",
              label: step.label || "Slack",
              userText: step.userText || plan.goal,
              toolkit: "slack",
              usePriorContent: true,
            },
          ],
          executeLookup,
          initialPriorContent: prior,
        });
        step.status = multi.ok ? "done" : "error";
        step.result = multi.content || "";
        step.error = multi.ok ? "" : step.result;
      } else {
        const spec =
          COMPOSIO_INTENT_SPECS.find((s) => s.id === step.specId) ||
          matchComposioIntent(step.userText || plan.goal);
        if (!spec) {
          step.status = "error";
          step.error = "Unknown composio intent";
        } else {
          const ran = await runComposioIntentExecute({
            runtime,
            userText: step.userText || plan.goal,
            spec,
            executeLookup,
          });
          step.status = ran.ok ? "done" : "error";
          step.result = ran.content || "";
          step.error = ran.ok ? "" : step.result;
        }
      }
      await savePlan(plan);
      if (step.status === "error") {
        plan.status = "error";
        plan.lastError = step.error;
        await savePlan(plan);
        return {
          handled: true,
          action: "reply",
          content: `Step failed (${step.label}): ${step.error}`,
          reason: "taskplan_step_error",
          taskPlanId: String(plan._id),
        };
      }
      continue;
    }

    if (step.kind === "verify") {
      const ok = plan.workingState?.lastSendOk === true;
      const to = plan.workingState?.lastSendTo || "";
      const subject = plan.workingState?.lastSendSubject || "";
      if (!ok) {
        step.status = "error";
        step.error = "Send was not confirmed ok";
        plan.status = "error";
        plan.lastError = step.error;
        await savePlan(plan);
        return {
          handled: true,
          action: "reply",
          content: "Could not verify the email send — the send step did not report success.",
          reason: "taskplan_verify_fail",
          taskPlanId: String(plan._id),
        };
      }
      step.status = "done";
      step.result = `Verified send to ${to}` + (subject ? ` (subject: ${subject})` : "");
      await savePlan(plan);
      continue;
    }

    step.status = "skipped";
    await savePlan(plan);
  }
}

/**
 * @param {object} plan
 * @returns {string}
 */
function formatPlanDoneMessage(plan) {
  const lines = [`Multi-step job finished: ${String(plan.goal || "").slice(0, 200)}`, ""];
  for (const s of plan.steps || []) {
    const mark = s.status === "done" ? "✓" : s.status === "error" ? "✗" : "·";
    lines.push(`${mark} ${s.label || s.kind}${s.result ? ` — ${String(s.result).slice(0, 180)}` : ""}`);
  }
  const ws = plan.workingState || {};
  if (ws.pageTitle) lines.push("", `Page title: ${ws.pageTitle}`);
  if (ws.lastSendTo) lines.push(`Emailed: ${ws.lastSendTo}`);
  return lines.join("\n");
}

/**
 * After computer Task completes, mark plan step done and continue.
 * @param {{
 *   userId: string,
 *   agent: object,
 *   task: object,
 *   success: boolean,
 *   summary: string,
 * }} opts
 */
export async function resumeTaskPlanAfterComputer(opts) {
  const task = opts.task;
  const planId = task?.taskPlanId || task?.comboFollowup?.taskPlanId;
  if (!planId) return { ok: true, skipped: true, reason: "no_taskplan" };

  const plan = await TaskPlan.findOne({
    _id: planId,
    user: opts.userId,
  });
  if (!plan) return { ok: false, reason: "plan_missing" };

  const step =
    (plan.steps || []).find((s) => s.status === "running" && s.kind === "computer") ||
    (plan.steps || []).find((s) => s.kind === "computer" && s.status !== "done");

  if (!opts.success) {
    if (step) {
      step.status = "error";
      step.error = String(opts.summary || "computer failed");
    }
    plan.status = "error";
    plan.lastError = step?.error || "computer failed";
    await savePlan(plan);
    await Message.create({
      chat: plan.chat,
      role: "assistant",
      content: `Multi-step job stopped — browser step failed: ${plan.lastError}`,
      meta: { kind: "taskplan_error", taskPlanId: String(plan._id) },
    }).catch(() => null);
    return { ok: false, reason: "computer_failed" };
  }

  plan.workingState = mergeComputerSummaryIntoWorkingState(
    plan.workingState,
    opts.summary
  );
  if (step) {
    step.status = "done";
    step.result = String(opts.summary || "").slice(0, 4000);
  }
  plan.activeTaskId = null;
  plan.status = "running";
  await savePlan(plan);

  const cont = await advanceTaskPlan({
    plan,
    agent: opts.agent,
    userId: opts.userId,
    chatId: String(plan.chat),
  });

  // If next action is another queue_goal, we cannot queue from worker — reply progress only.
  if (cont.action === "queue_goal") {
    await Message.create({
      chat: plan.chat,
      role: "assistant",
      content:
        "Browser step done. Remaining multi-step work needs another computer run — say “continue” or re-send the goal.",
      meta: { kind: "taskplan_need_requeue", taskPlanId: String(plan._id) },
    }).catch(() => null);
    return { ok: true, reason: "need_requeue" };
  }

  if (cont.action === "reply" && cont.content) {
    // advanceTaskPlan may have already posted done message
    if (cont.reason !== "taskplan_done") {
      await Message.create({
        chat: plan.chat,
        role: "assistant",
        content: cont.content,
        meta: {
          kind: "taskplan_progress",
          taskPlanId: String(plan._id),
          reason: cont.reason,
        },
      }).catch(() => null);
    }
  }

  return { ok: true, reason: cont.reason || "advanced" };
}

export { looksLikeHermesTaskPlanAsk, heuristicTaskPlanFromText };
