/**
 * @fileoverview Create / edit a YamBot agent definition.
 * Purpose: Capture profile, skill, instructions, facts, autonomy, success criteria.
 */

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { LiveScreen } from "../components/LiveScreen.jsx";
import { SiteProfilesPanel } from "../components/SiteProfilesPanel.jsx";

const EMPTY = {
  name: "",
  description: "",
  profile: "",
  skill: "",
  instructions: "",
  facts: [{ key: "", value: "" }],
  successCriteria: "",
  allowedDomains: "",
  startUrl: "",
  active: true,
  autonomy: {
    allowSubmit: true,
    allowCaptcha: true,
    askBeforeLogin: true,
    askBeforeSubmit: false,
    visionEnabled: true,
  },
  role: "worker",
  managedAgents: [],
  policy: {
    requireApprovalForSubmit: false,
    monthlyBudgetUsd: 0,
    escalateWaitingMinutes: 30,
    blockedUrlPatterns: [],
    httpAllowHosts: [],
  },
  schedule: {
    enabled: false,
    goal: "",
    interval: "1h",
    dailyAt: "09:00",
    lastRunAt: null,
    nextRunAt: null,
    chatId: null,
  },
  email: {
    enabled: false,
    fromName: "",
    fromAddress: "",
    smtpHost: "",
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: "",
    smtpPassword: "",
    imapHost: "",
    imapPort: 993,
    imapSecure: true,
    hasSmtpPassword: false,
  },
};

export function AgentEditPage() {
  const { agentId } = useParams();
  const isNew = !agentId || agentId === "new";
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [scheduleIntervals, setScheduleIntervals] = useState([
    "15m",
    "30m",
    "1h",
    "6h",
    "12h",
    "24h",
    "daily",
  ]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [okMsg, setOkMsg] = useState("");
  const [memoryNote, setMemoryNote] = useState("");
  const [memory, setMemory] = useState([]);
  const [allAgents, setAllAgents] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const meta = await api("/api/agents/meta");
        if (Array.isArray(meta.scheduleIntervals) && meta.scheduleIntervals.length) {
          setScheduleIntervals(meta.scheduleIntervals);
        }
        if (!isNew) {
          const data = await api(`/api/agents/${agentId}`);
          const a = data.agent;
          const agentsList = await api("/api/agents");
          setAllAgents((agentsList.agents || []).filter((x) => x._id !== agentId));
          setForm({
            name: a.name || "",
            description: a.description || "",
            profile: a.profile || "",
            skill: a.skill || "",
            instructions: a.instructions || "",
            facts: a.facts?.length ? a.facts : [{ key: "", value: "" }],
            successCriteria: a.successCriteria || "",
            allowedDomains: (a.allowedDomains || []).join(", "),
            startUrl: a.startUrl || "",
            active: a.active !== false,
            autonomy: {
              allowSubmit: a.autonomy?.allowSubmit !== false,
              allowCaptcha: a.autonomy?.allowCaptcha !== false,
              askBeforeLogin: a.autonomy?.askBeforeLogin === true,
              askBeforeSubmit: a.autonomy?.askBeforeSubmit === true,
              visionEnabled: a.autonomy?.visionEnabled !== false,
            },
            role: a.role === "manager" ? "manager" : "worker",
            managedAgents: (a.managedAgents || []).map(String),
            policy: {
              requireApprovalForSubmit: a.policy?.requireApprovalForSubmit === true,
              monthlyBudgetUsd: Number(a.policy?.monthlyBudgetUsd) || 0,
              escalateWaitingMinutes: Number(a.policy?.escalateWaitingMinutes) || 30,
              blockedUrlPatterns: a.policy?.blockedUrlPatterns || [],
              httpAllowHosts: a.policy?.httpAllowHosts || [],
            },
            schedule: {
              enabled: Boolean(a.schedule?.enabled),
              goal: a.schedule?.goal || "",
              interval: a.schedule?.interval || "1h",
              dailyAt: a.schedule?.dailyAt || "09:00",
              lastRunAt: a.schedule?.lastRunAt || null,
              nextRunAt: a.schedule?.nextRunAt || null,
              chatId: a.schedule?.chatId || null,
            },
            email: {
              enabled: Boolean(a.email?.enabled),
              fromName: a.email?.fromName || "",
              fromAddress: a.email?.fromAddress || "",
              smtpHost: a.email?.smtpHost || "",
              smtpPort: a.email?.smtpPort ?? 587,
              smtpSecure: Boolean(a.email?.smtpSecure),
              smtpUser: a.email?.smtpUser || "",
              smtpPassword: "",
              imapHost: a.email?.imapHost || "",
              imapPort: a.email?.imapPort ?? 993,
              imapSecure: a.email?.imapSecure !== false,
              hasSmtpPassword: Boolean(a.email?.hasSmtpPassword),
            },
          });
          setMemory(a.memory || []);
        }
      } catch (err) {
        setError(err);
      }
    })();
  }, [agentId, isNew]);

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateAutonomy(key, value) {
    setForm((prev) => ({
      ...prev,
      autonomy: { ...prev.autonomy, [key]: value },
    }));
  }

  function updateSchedule(key, value) {
    setForm((prev) => ({
      ...prev,
      schedule: { ...prev.schedule, [key]: value },
    }));
  }

  function updateEmail(key, value) {
    setForm((prev) => ({
      ...prev,
      email: { ...prev.email, [key]: value },
    }));
  }

  function updateFact(index, field, value) {
    setForm((prev) => {
      const facts = [...prev.facts];
      facts[index] = { ...facts[index], [field]: value };
      return { ...prev, facts };
    });
  }

  /**
   * @param {React.FormEvent} e
   */
  async function onSave(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOkMsg("");
    const payload = {
      ...form,
      facts: form.facts.filter((f) => f.key.trim()),
      allowedDomains: form.allowedDomains,
    };
    try {
      if (isNew) {
        const data = await api("/api/agents", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setOkMsg("Agent created");
        navigate(`/agents/${data.agent._id}`, { replace: true });
      } else {
        const data = await api(`/api/agents/${agentId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        setOkMsg("Agent saved");
        if (data?.agent?.email) {
          setForm((prev) => ({
            ...prev,
            email: {
              ...prev.email,
              ...data.agent.email,
              smtpPassword: "",
              hasSmtpPassword: Boolean(data.agent.email.hasSmtpPassword),
            },
          }));
        }
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (isNew) return;
    if (
      !window.confirm(
        "Delete this agent? Its cloud computer container will be stopped and removed."
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await api(`/api/agents/${agentId}`, { method: "DELETE" });
      navigate("/agents");
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/agents"
          className="inline-flex min-h-11 items-center rounded-xl border border-teal-100 bg-white px-3 text-sm font-semibold"
        >
          ← Agents
        </Link>
        <h1 className="text-xl font-bold tracking-tight">
          {isNew ? "New agent" : "Edit agent"}
        </h1>
      </div>

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}
      {okMsg ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {okMsg}
        </div>
      ) : null}

      <form onSubmit={onSave} className="flex flex-col gap-3 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Short description
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Skill
          <textarea
            className="min-h-20 rounded-xl border border-teal-100 px-3 py-2"
            value={form.skill}
            onChange={(e) => update("skill", e.target.value)}
            placeholder="What this agent is good at, e.g. compare competitor pricing and summarize findings"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Profile / persona
          <textarea
            className="min-h-24 rounded-xl border border-teal-100 px-3 py-2"
            value={form.profile}
            onChange={(e) => update("profile", e.target.value)}
            placeholder="Who this agent is, tone, role…"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Standing instructions
          <textarea
            className="min-h-28 rounded-xl border border-teal-100 px-3 py-2"
            value={form.instructions}
            onChange={(e) => update("instructions", e.target.value)}
            placeholder="Clear rules for every run…"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Success criteria
          <textarea
            className="min-h-20 rounded-xl border border-teal-100 px-3 py-2"
            value={form.successCriteria}
            onChange={(e) => update("successCriteria", e.target.value)}
            placeholder="When to finish, e.g. summarize top 5 links with URLs"
          />
        </label>
        <div className="rounded-xl border border-teal-100 bg-teal-50/50 p-3 text-sm text-teal-900/80">
          <div className="font-semibold text-teal-900/90">Cloud computer</div>
          <p className="mt-1 text-xs text-teal-900/70">
            Each agent gets a dedicated Chromium container on the VPS. Use{" "}
            <strong>Take control</strong> on the live screen to click, type, or solve captchas.
            {!isNew ? (
              <>
                {" "}
                Agent ID: <code className="break-all rounded bg-white px-1">{agentId}</code>
              </>
            ) : null}
          </p>
        </div>

        <fieldset className="flex flex-col gap-3 rounded-xl border border-teal-100 bg-teal-50/40 p-3">
          <legend className="px-1 text-sm font-semibold text-teal-900">Scheduler</legend>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(form.schedule?.enabled)}
              onChange={(e) => updateSchedule("enabled", e.target.checked)}
            />
            Run a goal on a schedule for this agent
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Scheduled goal
            <textarea
              className="min-h-24 rounded-xl border border-teal-100 bg-white px-3 py-2"
              value={form.schedule?.goal || ""}
              onChange={(e) => updateSchedule("goal", e.target.value)}
              placeholder="Goal to enqueue automatically…"
              disabled={!form.schedule?.enabled}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Frequency
            <select
              className="min-h-11 rounded-xl border border-teal-100 bg-white px-3"
              value={form.schedule?.interval || "1h"}
              onChange={(e) => updateSchedule("interval", e.target.value)}
              disabled={!form.schedule?.enabled}
            >
              {scheduleIntervals.map((iv) => (
                <option key={iv} value={iv}>
                  {iv === "daily"
                    ? "Once daily (UTC time below)"
                    : iv === "15m"
                      ? "Every 15 minutes"
                      : iv === "30m"
                        ? "Every 30 minutes"
                        : iv === "1h"
                          ? "Every hour"
                          : iv === "6h"
                            ? "Every 6 hours"
                            : iv === "12h"
                              ? "Every 12 hours"
                              : "Every 24 hours"}
                </option>
              ))}
            </select>
          </label>
          {form.schedule?.interval === "daily" ? (
            <label className="flex flex-col gap-1 text-sm">
              Daily time (UTC)
              <input
                className="min-h-11 rounded-xl border border-teal-100 bg-white px-3"
                type="time"
                value={form.schedule?.dailyAt || "09:00"}
                onChange={(e) => updateSchedule("dailyAt", e.target.value)}
                disabled={!form.schedule?.enabled}
              />
            </label>
          ) : null}
          {(form.schedule?.lastRunAt || form.schedule?.nextRunAt) && (
            <p className="text-xs text-teal-900/70">
              {form.schedule.lastRunAt
                ? `Last run: ${new Date(form.schedule.lastRunAt).toLocaleString()}. `
                : null}
              {form.schedule.nextRunAt
                ? `Next run: ${new Date(form.schedule.nextRunAt).toLocaleString()}.`
                : null}
            </p>
          )}
          <p className="text-xs text-teal-900/60">
            Scheduled runs appear in a chat titled “Schedule · {form.name || "agent"}”. Skips a tick
            if this agent already has a pending/running task.
          </p>
        </fieldset>

        <fieldset className="flex flex-col gap-3 rounded-xl border border-teal-100 bg-white p-3">
          <legend className="px-1 text-sm font-semibold text-teal-900">Email (SMTP)</legend>
          <p className="text-xs text-teal-900/60">
            Give this agent a real mailbox so it can send mail and read the inbox (verification codes,
            outreach) like a human. Password is stored encrypted on the server.
          </p>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(form.email?.enabled)}
              onChange={(e) => updateEmail("enabled", e.target.checked)}
            />
            Enable email for this agent
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              From name
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                value={form.email?.fromName || ""}
                onChange={(e) => updateEmail("fromName", e.target.value)}
                placeholder="Alex Rivera"
                disabled={!form.email?.enabled}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              From address
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                type="email"
                value={form.email?.fromAddress || ""}
                onChange={(e) => updateEmail("fromAddress", e.target.value)}
                placeholder="alex@example.com"
                disabled={!form.email?.enabled}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              SMTP host
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                value={form.email?.smtpHost || ""}
                onChange={(e) => updateEmail("smtpHost", e.target.value)}
                placeholder="smtp.gmail.com"
                disabled={!form.email?.enabled}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              SMTP port
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                type="number"
                value={form.email?.smtpPort ?? 587}
                onChange={(e) => updateEmail("smtpPort", Number(e.target.value) || 587)}
                disabled={!form.email?.enabled}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              SMTP username
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                value={form.email?.smtpUser || ""}
                onChange={(e) => updateEmail("smtpUser", e.target.value)}
                placeholder="usually same as from address"
                disabled={!form.email?.enabled}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              SMTP password
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                type="password"
                value={form.email?.smtpPassword || ""}
                onChange={(e) => updateEmail("smtpPassword", e.target.value)}
                placeholder={
                  form.email?.hasSmtpPassword ? "Saved — leave blank to keep" : "App password / SMTP secret"
                }
                disabled={!form.email?.enabled}
                autoComplete="new-password"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              IMAP host (inbox)
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                value={form.email?.imapHost || ""}
                onChange={(e) => updateEmail("imapHost", e.target.value)}
                placeholder="imap.gmail.com (optional if smtp.* → imap.*)"
                disabled={!form.email?.enabled}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              IMAP port
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                type="number"
                value={form.email?.imapPort ?? 993}
                onChange={(e) => updateEmail("imapPort", Number(e.target.value) || 993)}
                disabled={!form.email?.enabled}
              />
            </label>
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(form.email?.smtpSecure)}
              onChange={(e) => updateEmail("smtpSecure", e.target.checked)}
              disabled={!form.email?.enabled}
            />
            SMTP TLS on connect (port 465)
          </label>
          {!isNew ? (
            <button
              type="button"
              disabled={busy || !form.email?.enabled}
              onClick={async () => {
                setBusy(true);
                setError(null);
                setOkMsg("");
                try {
                  await api(`/api/agents/${agentId}/email/test`, {
                    method: "POST",
                    body: JSON.stringify({}),
                  });
                  setOkMsg("Test email sent to the from address.");
                } catch (err) {
                  setError(err);
                } finally {
                  setBusy(false);
                }
              }}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-teal-200 bg-teal-50 px-3 text-sm font-semibold text-teal-900 disabled:opacity-50 sm:w-auto"
            >
              Send test email
            </button>
          ) : (
            <p className="text-xs text-teal-900/60">Save the agent first, then you can send a test email.</p>
          )}
        </fieldset>

        {!isNew ? (
          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold text-teal-900/80">Live cloud screen</div>
            <LiveScreen agentId={agentId} compact />
          </div>
        ) : null}

        <label className="flex flex-col gap-1 text-sm">
          Start URL (optional)
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.startUrl}
            onChange={(e) => update("startUrl", e.target.value)}
            placeholder="Optional — leave empty for blank page"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Allowed domains (comma-separated, empty = any)
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.allowedDomains}
            onChange={(e) => update("allowedDomains", e.target.value)}
            placeholder="news.google.com, reuters.com"
          />
        </label>

        <div>
          <div className="mb-2 text-sm font-semibold text-teal-900/80">Facts</div>
          <div className="flex flex-col gap-2">
            {form.facts.map((f, i) => (
              <div key={i} className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="min-h-11 flex-1 rounded-xl border border-teal-100 px-3"
                  placeholder="Key (e.g. product_url)"
                  value={f.key}
                  onChange={(e) => updateFact(i, "key", e.target.value)}
                />
                <input
                  className="min-h-11 flex-[2] rounded-xl border border-teal-100 px-3"
                  placeholder="Value"
                  value={f.value}
                  onChange={(e) => updateFact(i, "value", e.target.value)}
                />
              </div>
            ))}
            <button
              type="button"
              className="min-h-11 self-start rounded-xl border border-teal-100 px-3 text-sm font-semibold"
              onClick={() =>
                setForm((prev) => ({
                  ...prev,
                  facts: [...prev.facts, { key: "", value: "" }],
                }))
              }
            >
              Add fact
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-teal-100 pt-3">
          <div className="text-sm font-semibold text-teal-900/80">Workforce role</div>
          <label className="flex flex-col gap-1 text-sm">
            Role
            <select
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              value={form.role}
              onChange={(e) => update("role", e.target.value)}
            >
              <option value="worker">Worker — executes browser tasks</option>
              <option value="manager">Manager — can delegate goals to managed agents</option>
            </select>
          </label>
          {form.role === "manager" && !isNew ? (
            <div className="flex flex-col gap-1 text-sm">
              <span>Managed agents</span>
              <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-xl border border-teal-100 p-2">
                {allAgents.length === 0 ? (
                  <span className="text-teal-900/50">Create more agents to manage.</span>
                ) : (
                  allAgents.map((ag) => (
                    <label key={ag._id} className="flex min-h-9 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={form.managedAgents.includes(String(ag._id))}
                        onChange={(e) => {
                          const id = String(ag._id);
                          setForm((prev) => ({
                            ...prev,
                            managedAgents: e.target.checked
                              ? [...prev.managedAgents, id]
                              : prev.managedAgents.filter((x) => x !== id),
                          }));
                        }}
                      />
                      {ag.name}
                    </label>
                  ))
                )}
              </div>
            </div>
          ) : null}
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.policy.requireApprovalForSubmit}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  policy: { ...prev.policy, requireApprovalForSubmit: e.target.checked },
                }))
              }
            />
            Agent policy: require Governance approval before submit
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-sm font-semibold text-teal-900/80">Autonomy</div>
          {[
            ["allowSubmit", "Allow submit / apply clicks"],
            ["allowCaptcha", "Allow CAPTCHA solving"],
            ["askBeforeLogin", "Ask before login walls"],
            ["askBeforeSubmit", "Ask before submit clicks"],
            ["visionEnabled", "Enable vision screenshots (error recovery on cloud worker)"],
          ].map(([key, label]) => (
            <label key={key} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(form.autonomy[key])}
                onChange={(e) => updateAutonomy(key, e.target.checked)}
              />
              {label}
            </label>
          ))}
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(form.active)}
              onChange={(e) => update("active", e.target.checked)}
            />
            Active
          </label>
        </div>

        {!isNew ? (
          <div className="flex flex-col gap-2 border-t border-teal-100 pt-3">
            <div className="text-sm font-semibold text-teal-900/80">Memory</div>
            <p className="text-xs text-teal-900/60">
              Filled automatically after runs. You can also add notes the agent should remember.
            </p>
            <ul className="max-h-48 overflow-y-auto rounded-xl border border-teal-100 bg-teal-50/50 p-2 text-sm">
              {memory.length === 0 ? (
                <li className="text-teal-900/50">No memories yet.</li>
              ) : (
                memory.map((m, i) => (
                  <li key={i} className="border-b border-teal-100/80 py-2 last:border-0">
                    <span className="text-xs uppercase text-teal-800/50">{m.kind}</span>
                    <div className="whitespace-pre-wrap">{m.content}</div>
                  </li>
                ))
              )}
            </ul>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                className="min-h-11 flex-1 rounded-xl border border-teal-100 px-3"
                placeholder="Add a memory note…"
                value={memoryNote}
                onChange={(e) => setMemoryNote(e.target.value)}
              />
              <button
                type="button"
                className="min-h-11 rounded-xl border border-teal-100 px-3 text-sm font-semibold"
                onClick={async () => {
                  if (!memoryNote.trim()) return;
                  setBusy(true);
                  try {
                    const data = await api(`/api/agents/${agentId}/memory`, {
                      method: "POST",
                      body: JSON.stringify({ content: memoryNote, kind: "note" }),
                    });
                    setMemory(data.agent.memory || []);
                    setMemoryNote("");
                  } catch (err) {
                    setError(err);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Add note
              </button>
              <button
                type="button"
                className="min-h-11 rounded-xl border border-red-200 px-3 text-sm font-semibold text-red-700"
                onClick={async () => {
                  if (!window.confirm("Clear all memory for this agent?")) return;
                  setBusy(true);
                  try {
                    const data = await api(`/api/agents/${agentId}/memory`, {
                      method: "DELETE",
                    });
                    setMemory(data.agent.memory || []);
                  } catch (err) {
                    setError(err);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Clear
              </button>
            </div>
          </div>
        ) : null}

        {!isNew ? <SiteProfilesPanel agentId={agentId} /> : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save agent"}
          </button>
          {!isNew ? (
            <button
              type="button"
              disabled={busy}
              onClick={onDelete}
              className="min-h-11 rounded-xl border border-red-200 bg-red-50 px-4 font-semibold text-red-700"
            >
              Delete
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
