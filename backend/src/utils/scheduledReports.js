/**
 * @fileoverview Scheduled reports — weekly dashboard email via agent SMTP.
 * Purpose: Automated ops summaries without manual export.
 * Downstream: scheduler tick.
 */

import { User } from "../models/User.js";
import { Agent } from "../models/Agent.js";
import { Ticket } from "../models/Ticket.js";
import { Task } from "../models/Task.js";
import { Deal } from "../models/Deal.js";
import { CompanyMemory } from "../models/CompanyMemory.js";
import { sendAgentEmail } from "./agentEmail.js";

/**
 * @param {string} userId
 */
export async function tickScheduledReports() {
  const configs = await CompanyMemory.find({
    key: "weekly_report_enabled",
    value: "true",
  }).limit(20);

  let sent = 0;
  const now = new Date();
  const isMonday = now.getUTCDay() === 1;
  const hour = now.getUTCHours();
  if (!isMonday || hour !== 9) return { sent: 0, skipped: "not_scheduled_window" };

  for (const cfg of configs) {
    const userId = String(cfg.user);
    const lastKey = await CompanyMemory.findOne({ user: userId, key: "weekly_report_last_sent" });
    const last = lastKey?.value ? new Date(lastKey.value) : null;
    if (last && now - last < 6 * 24 * 60 * 60 * 1000) continue;

    const toMem = await CompanyMemory.findOne({ user: userId, key: "weekly_report_email" });
    const to = String(toMem?.value || "").trim();
    if (!to) continue;

    const agent = await Agent.findOne({ user: userId, "email.enabled": true }).sort({ updatedAt: -1 });
    if (!agent) continue;

    const [openTickets, doneTasks, openDeals] = await Promise.all([
      Ticket.countDocuments({ user: userId, status: { $nin: ["closed", "resolved"] } }),
      Task.countDocuments({
        user: userId,
        status: "done",
        completedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      }),
      Deal.countDocuments({ user: userId, stage: { $nin: ["won", "lost"] } }),
    ]);

    const body = [
      "YamBot Weekly Report",
      "",
      `Open tickets: ${openTickets}`,
      `Tasks completed (7d): ${doneTasks}`,
      `Open deals: ${openDeals}`,
      "",
      `Generated: ${now.toISOString()}`,
    ].join("\n");

    try {
      await sendAgentEmail(agent, { to, subject: "YamBot weekly report", text: body });
      await CompanyMemory.findOneAndUpdate(
        { user: userId, key: "weekly_report_last_sent" },
        { value: now.toISOString(), category: "system" },
        { upsert: true }
      );
      sent += 1;
    } catch (err) {
      console.warn("[scheduledReports] send failed", userId, err?.message);
    }
  }
  return { sent };
}
