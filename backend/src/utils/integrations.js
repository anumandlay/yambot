/**
 * @fileoverview Outbound integrations — Slack, webhooks, calendar invites.
 * Purpose: Let agents notify external systems without browser automation.
 * Downstream: worker send_slack / send_webhook / create_calendar_event actions.
 */

import { CompanyMemory } from "../models/CompanyMemory.js";

/**
 * Loads integration URLs from company memory keys.
 * @param {string} userId
 */
export async function loadIntegrationConfig(userId) {
  const rows = await CompanyMemory.find({
    user: userId,
    key: { $in: ["slack_webhook_url", "default_webhook_url", "calendar_organizer_email"] },
  }).lean();
  /** @type {Record<string, string>} */
  const cfg = {};
  for (const r of rows) cfg[r.key] = String(r.value || "").trim();
  return cfg;
}

/**
 * @param {string} webhookUrl
 * @param {object} payload
 */
export async function postWebhook(webhookUrl, payload) {
  const url = String(webhookUrl || "").trim();
  if (!url.startsWith("https://")) {
    return { ok: false, detail: "webhook URL must be https" };
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body: text.slice(0, 500) };
}

/**
 * Slack incoming webhook — text or blocks payload.
 * @param {string} webhookUrl
 * @param {object} opts
 */
export async function sendSlackMessage(webhookUrl, opts) {
  const text = String(opts.text || opts.message || "").trim();
  if (!text) return { ok: false, detail: "text required" };
  return postWebhook(webhookUrl, {
    text,
    blocks: opts.blocks || undefined,
    username: opts.username || "YamBot",
  });
}

/**
 * Builds a simple ICS calendar invite string (no external API).
 * @param {object} opts
 */
export function buildIcsInvite(opts) {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@yambot`;
  const start = opts.startAt ? new Date(opts.startAt) : new Date(Date.now() + 3600_000);
  const end = opts.endAt ? new Date(opts.endAt) : new Date(start.getTime() + 3600_000);
  const fmt = (d) =>
    d
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//YamBot//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${String(opts.title || "Meeting").replace(/\n/g, " ")}`,
    `DESCRIPTION:${String(opts.description || "").replace(/\n/g, "\\n")}`,
    opts.location ? `LOCATION:${String(opts.location).replace(/\n/g, " ")}` : "",
    opts.attendee ? `ATTENDEE:mailto:${opts.attendee}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}

/**
 * @param {string} userId
 * @param {object} opts
 */
export async function createCalendarEvent(userId, opts) {
  const cfg = await loadIntegrationConfig(userId);
  const ics = buildIcsInvite({
    title: opts.title,
    description: opts.description,
    startAt: opts.startAt,
    endAt: opts.endAt,
    location: opts.location,
    attendee: opts.attendee || cfg.calendar_organizer_email,
  });
  return {
    ok: true,
    ics,
    downloadHint: "Attach ICS to email or import into calendar app",
    organizer: cfg.calendar_organizer_email || null,
    googleCalendarUrl: buildGoogleCalendarUrl(opts),
  };
}

/**
 * @param {object} opts
 */
export function buildGoogleCalendarUrl(opts) {
  const start = opts.startAt ? new Date(opts.startAt) : new Date(Date.now() + 3600_000);
  const end = opts.endAt ? new Date(opts.endAt) : new Date(start.getTime() + 3600_000);
  const fmt = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: String(opts.title || "Meeting"),
    dates: `${fmt(start)}/${fmt(end)}`,
    details: String(opts.description || ""),
    location: String(opts.location || ""),
  });
  if (opts.attendee) params.set("add", String(opts.attendee));
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
