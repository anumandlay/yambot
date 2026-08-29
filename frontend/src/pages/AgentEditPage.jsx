/**
 * @fileoverview Create / edit a YamBot agent definition.
 * Purpose: Capture profile, skill, instructions, facts, autonomy, success criteria.
 */

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import {
  ButtonWithHelp,
  FieldLabel,
  PageGuideBanner,
  SectionTitle,
} from "../components/FieldLabel.jsx";
import { HelpTooltip } from "../components/HelpTooltip.jsx";
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
  group: "",
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
    dailyBudgetUsd: 0,
    maxTaskMinutes: 0,
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
  llm: {
    profileId: "",
    /** True only for pre-profile agents that still have inline credentials. */
    useCustom: false,
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
  const [jobBrief, setJobBrief] = useState("");
  const [draftBusy, setDraftBusy] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
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
  const [clearBusy, setClearBusy] = useState(false);
  const [clearNotice, setClearNotice] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [memoryNote, setMemoryNote] = useState("");
  const [memory, setMemory] = useState([]);
  const [allAgents, setAllAgents] = useState([]);
  const [agentGroups, setAgentGroups] = useState([]);
  const [llmProfiles, setLlmProfiles] = useState([]);
  const [walletInfo, setWalletInfo] = useState({ balanceUsd: 0, agentPriceUsd: 0 });

  useEffect(() => {
    if (!isNew) return;
    api("/api/wallet")
      .then((data) => {
        setWalletInfo({
          balanceUsd: Number(data.wallet?.balanceUsd) || 0,
          agentPriceUsd: Number(data.agentPriceUsd) || 0,
        });
      })
      .catch(() => {});
  }, [isNew]);

  useEffect(() => {
    (async () => {
      try {
        const meta = await api("/api/agents/meta");
        if (Array.isArray(meta.scheduleIntervals) && meta.scheduleIntervals.length) {
          setScheduleIntervals(meta.scheduleIntervals);
        }
        const groupData = await api("/api/groups?type=agent");
        setAgentGroups(groupData.groups || []);
        try {
          const llmData = await api("/api/llm-profiles");
          setLlmProfiles(llmData.profiles || []);
        } catch {
          setLlmProfiles([]);
        }
        if (!isNew) {
          const data = await api(`/api/agents/${agentId}`);
          const a = data.agent;
          const agentsList = await api("/api/agents");
          setAllAgents((agentsList.agents || []).filter((x) => x._id !== agentId));
          setForm({
            name: a.name || "",
            group: a.group ? String(a.group) : "",
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
              dailyBudgetUsd: Number(a.policy?.dailyBudgetUsd) || 0,
              maxTaskMinutes: Number(a.policy?.maxTaskMinutes) || 0,
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
            llm: {
              profileId: a.llm?.profileId || "",
              useCustom: Boolean(a.llm?.useCustom && !a.llm?.profileId),
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

  /**
   * @param {string} key
   * @param {unknown} value
   */
  function updateLlm(key, value) {
    setForm((prev) => ({
      ...prev,
      llm: { ...prev.llm, [key]: value },
    }));
  }

  /**
   * @param {number} index
   * @param {string} field
   * @param {string} value
   */
  function updateFact(index, field, value) {
    setForm((prev) => {
      const facts = [...prev.facts];
      facts[index] = { ...facts[index], [field]: value };
      return { ...prev, facts };
    });
  }

  /**
   * Fills persona / skill / instructions / success criteria from a plain-English job brief.
   */
  async function generateFromBrief() {
    setDraftBusy(true);
    setError(null);
    setOkMsg("");
    try {
      const data = await api("/api/agents/draft-from-brief", {
        method: "POST",
        body: JSON.stringify({ brief: jobBrief }),
        timeoutMs: 90_000,
      });
      const d = data.draft || {};
      setForm((prev) => ({
        ...prev,
        name: prev.name.trim() ? prev.name : d.name || prev.name,
        description: prev.description.trim() ? prev.description : d.description || prev.description,
        skill: d.skill || prev.skill,
        profile: d.profile || prev.profile,
        instructions: d.instructions || prev.instructions,
        successCriteria: d.successCriteria || prev.successCriteria,
      }));
      setOkMsg("AI filled skill, persona, instructions, and success criteria — review and save.");
    } catch (err) {
      setError(err);
    } finally {
      setDraftBusy(false);
    }
  }

  /**
   * Imports CSV leads into this agent's territory group (selected Group field).
   * @param {string} text
   */
  async function importLeadsCsv(text) {
    const csv = String(text || "").trim();
    if (!csv) return;
    if (!form.group) {
      setError({
        title: "Pick a group first",
        detail: "Select a Group (e.g. USA) above so leads go into that territory database.",
        hint: "Create groups on the Agents list if you do not have one yet.",
      });
      return;
    }
    setImportBusy(true);
    setError(null);
    setOkMsg("");
    try {
      const data = await api("/api/entities/import", {
        method: "POST",
        body: JSON.stringify({
          csv,
          entityType: "lead",
          updateExisting: true,
          groupId: form.group,
        }),
        timeoutMs: 120_000,
      });
      setCsvText("");
      const groupName =
        agentGroups.find((g) => String(g._id) === String(form.group))?.name || "this group";
      const parts = [
        `${data.created || 0} created`,
        `${data.updated || 0} updated`,
        `territory: ${groupName}`,
      ];
      if (data.skipped) parts.push(`${data.skipped} skipped`);
      setOkMsg(`Leads imported: ${parts.join(", ")}. Agents in this group can search_entities them.`);
    } catch (err) {
      setError(err);
    } finally {
      setImportBusy(false);
    }
  }

  /**
   * @param {import("react").ChangeEvent<HTMLInputElement>} e
   */
  async function onLeadsCsvFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const text = await file.text();
    await importLeadsCsv(text);
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
      group: form.group || null,
      facts: form.facts.filter((f) => f.key.trim()),
      allowedDomains: form.allowedDomains,
      llm: {
        profileId: form.llm?.profileId || "",
        // Why: preserve pre-profile inline override until the user picks Default or a named profile.
        useCustom: Boolean(!form.llm?.profileId && form.llm?.useCustom),
      },
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
        setForm((prev) => ({
          ...prev,
          llm: data?.agent?.llm
            ? {
                profileId: data.agent.llm.profileId || "",
                useCustom: Boolean(data.agent.llm.useCustom && !data.agent.llm.profileId),
              }
            : prev.llm,
          email: data?.agent?.email
            ? {
                ...prev.email,
                ...data.agent.email,
                smtpPassword: "",
                hasSmtpPassword: Boolean(data.agent.email.hasSmtpPassword),
              }
            : prev.email,
        }));
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

  /**
   * Queues a worker command to wipe cookies, HTTP caches, and downloads on this agent's box.
   */
  async function onClearBrowserData() {
    if (isNew || !agentId) return;
    if (
      !window.confirm(
        "Clear cookies, cache, and downloads for this agent's cloud browser?\n\nYou will be logged out of sites in this box. Uploads folder is kept. Chromium restarts briefly."
      )
    ) {
      return;
    }
    setClearBusy(true);
    setClearNotice("");
    setError(null);
    try {
      const data = await api(`/api/agents/${agentId}/control`, {
        method: "POST",
        body: JSON.stringify({ type: "clear_browser_data" }),
      });
      setClearNotice(
        data.detail ||
          "Queued — cookies, cache, and downloads will clear within a few seconds."
      );
    } catch (err) {
      setError(err);
    } finally {
      setClearBusy(false);
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
      <PageGuideBanner helpId="agents.page" title="Agent editor guide" />

      {isNew && walletInfo.agentPriceUsd > 0 ? (
        <div
          className={`rounded-xl border p-3 text-sm ${
            walletInfo.balanceUsd >= walletInfo.agentPriceUsd
              ? "border-teal-200 bg-teal-50 text-teal-900"
              : "border-amber-200 bg-amber-50 text-amber-950"
          }`}
        >
          Creating this agent costs <strong>${walletInfo.agentPriceUsd.toFixed(2)}</strong>. Wallet
          balance: <strong>${walletInfo.balanceUsd.toFixed(2)}</strong>.
          {walletInfo.balanceUsd < walletInfo.agentPriceUsd ? (
            <>
              {" "}
              <Link to="/wallet" className="font-semibold underline">
                Top up wallet
              </Link>
            </>
          ) : null}
        </div>
      ) : null}

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
        <div className="flex flex-col gap-2 rounded-xl border border-violet-100 bg-violet-50/50 p-3">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <FieldLabel helpId="agent.jobBrief">Describe the job in plain English</FieldLabel>
            <HelpTooltip
              helpId="agent.entitiesGuide"
              alwaysVisible
              linkLabel="Entities & how to use →"
            />
          </span>
          <p className="text-xs text-violet-950/70">
            Example: search Google for new travel agency leads and save them in the database with
            email and phone — or “collect daily weather with city, tempC, humidity into a weather
            table”. AI will draft persona, skill, standing instructions, and success criteria.
            Assign the country group below separately.
          </p>
          <textarea
            className="min-h-24 rounded-xl border border-violet-100 bg-white px-3 py-2 text-sm"
            value={jobBrief}
            onChange={(e) => setJobBrief(e.target.value)}
            placeholder="e.g. Search Google for new leads and save them in the database…"
            disabled={draftBusy}
          />
          <button
            type="button"
            disabled={draftBusy || jobBrief.trim().length < 8}
            onClick={generateFromBrief}
            className="min-h-11 rounded-xl bg-violet-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {draftBusy ? "Generating…" : "Generate with AI"}
          </button>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="agent.name" required>
            Name
          </FieldLabel>
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="agent.group">Group</FieldLabel>
          <select
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.group}
            onChange={(e) => update("group", e.target.value)}
          >
            <option value="">No group</option>
            {agentGroups.map((g) => (
              <option key={g._id} value={g._id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-2 rounded-xl border border-teal-100 bg-teal-50/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <FieldLabel helpId="agent.leadsUpload">Upload leads to this agent’s group</FieldLabel>
            <label className="cursor-pointer text-xs font-semibold text-teal-800 underline">
              Choose CSV file
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={onLeadsCsvFile}
                disabled={importBusy}
              />
            </label>
          </div>
          <p className="text-xs text-teal-900/65">
            Imports into the <strong>Group</strong> selected above (e.g. USA). All agents in that
            group share these leads. Formats:{" "}
            <code className="font-mono text-[0.7rem]">email,name,company</code> or{" "}
            <code className="font-mono text-[0.7rem]">name,type,email</code>.
            {!form.group ? (
              <span className="font-semibold text-amber-800"> Select a group first.</span>
            ) : (
              <span>
                {" "}
                Territory:{" "}
                <strong>
                  {agentGroups.find((g) => String(g._id) === String(form.group))?.name || "selected"}
                </strong>
              </span>
            )}
          </p>
          <textarea
            className="min-h-24 rounded-xl border border-teal-100 bg-white px-3 py-2 font-mono text-xs"
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={
              "email,name,company\njane@agency.com,Jane Doe,Sunrise Travel\n\nor:\n\nname,type,email\nSunrise Travel,lead,support@vughy.com"
            }
            disabled={importBusy}
          />
          <button
            type="button"
            disabled={importBusy || !csvText.trim() || !form.group}
            onClick={() => importLeadsCsv(csvText)}
            className="min-h-11 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {importBusy ? "Importing…" : "Import leads"}
          </button>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="agent.description">Short description</FieldLabel>
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="agent.skill">Skill</FieldLabel>
          <textarea
            className="min-h-20 rounded-xl border border-teal-100 px-3 py-2"
            value={form.skill}
            onChange={(e) => update("skill", e.target.value)}
            placeholder="What this agent is good at, e.g. compare competitor pricing and summarize findings"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="agent.profile">Profile / persona</FieldLabel>
          <textarea
            className="min-h-24 rounded-xl border border-teal-100 px-3 py-2"
            value={form.profile}
            onChange={(e) => update("profile", e.target.value)}
            placeholder="Who this agent is, tone, role…"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <FieldLabel helpId="agent.instructions">Standing instructions</FieldLabel>
            <HelpTooltip
              helpId="agent.entitiesGuide"
              alwaysVisible
              linkLabel="Entities & how to use →"
            />
          </span>
          <textarea
            className="min-h-28 rounded-xl border border-teal-100 px-3 py-2"
            value={form.instructions}
            onChange={(e) => update("instructions", e.target.value)}
            placeholder="Clear rules for every run… e.g. create_entity for new leads with status new"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="agent.successCriteria">Success criteria</FieldLabel>
          <textarea
            className="min-h-20 rounded-xl border border-teal-100 px-3 py-2"
            value={form.successCriteria}
            onChange={(e) => update("successCriteria", e.target.value)}
            placeholder="When to finish, e.g. summarize top 5 links with URLs"
          />
        </label>
        <div className="rounded-xl border-2 border-amber-200 bg-amber-50/70 p-4 text-sm text-teal-900/80">
          <SectionTitle helpId="agent.cloudComputer" className="font-semibold text-teal-900/90">
            Cloud computer
          </SectionTitle>
          <p className="mt-1 text-xs text-teal-900/70">
            Each agent gets a dedicated Chromium container on the VPS. Use{" "}
            <strong>Take control</strong> on the live screen to click, type, or solve captchas.
            {!isNew ? (
              <>
                {" "}
                Agent ID: <code className="break-all rounded bg-white px-1">{agentId}</code>
              </>
            ) : (
              <span className="mt-1 block text-amber-900/80">
                Save the agent first — then you can clear cookies, cache, and downloads here.
              </span>
            )}
          </p>
          {!isNew ? (
            <div className="mt-3 flex flex-col gap-2 border-t border-amber-200/80 pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-950">
                Browser data
              </p>
              <ButtonWithHelp helpId="agent.clearBrowserData">
                <button
                  type="button"
                  disabled={busy || clearBusy}
                  onClick={() => void onClearBrowserData()}
                  className="min-h-11 w-full rounded-xl border border-amber-300 bg-white px-4 text-sm font-semibold text-amber-950 shadow-sm disabled:opacity-50 sm:w-auto"
                >
                  {clearBusy ? "Clearing…" : "Clear cookies, cache & downloads"}
                </button>
              </ButtonWithHelp>
              {clearNotice ? (
                <p className="text-xs text-teal-800">{clearNotice}</p>
              ) : (
                <p className="text-xs text-amber-900/70">
                  Logs you out of sites in this box. Uploads are kept. Chromium restarts briefly.
                </p>
              )}
            </div>
          ) : null}
        </div>

        <fieldset className="flex flex-col gap-3 rounded-xl border border-teal-100 bg-teal-50/40 p-3">
          <legend className="px-1">
            <SectionTitle helpId="agent.schedule.enabled" as="div" className="text-sm font-semibold text-teal-900">
              Scheduler
            </SectionTitle>
          </legend>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(form.schedule?.enabled)}
              onChange={(e) => updateSchedule("enabled", e.target.checked)}
            />
            <FieldLabel helpId="agent.schedule.enabled">
              Run a goal on a schedule for this agent
            </FieldLabel>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="agent.schedule.goal">Scheduled goal</FieldLabel>
            <textarea
              className="min-h-24 rounded-xl border border-teal-100 bg-white px-3 py-2"
              value={form.schedule?.goal || ""}
              onChange={(e) => updateSchedule("goal", e.target.value)}
              placeholder="Goal to enqueue automatically…"
              disabled={!form.schedule?.enabled}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="agent.schedule.interval">Frequency</FieldLabel>
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
              <FieldLabel helpId="agent.schedule.dailyAt">Daily time (UTC)</FieldLabel>
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
          <legend className="px-1">
            <SectionTitle helpId="agent.llm.profile" as="div" className="text-sm font-semibold text-teal-900">
              LLM
            </SectionTitle>
          </legend>
          <p className="text-xs text-teal-900/60">
            Pick a saved LLM for this agent, or use the account default from Settings. Manage profiles
            under{" "}
            <Link to="/settings/llms" className="font-semibold text-teal-800 underline">
              Settings → LLM profiles
            </Link>
            .
          </p>
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="agent.llm.profile">LLM for this agent</FieldLabel>
            <select
              className="min-h-11 rounded-xl border border-teal-100 bg-white px-3"
              value={form.llm?.profileId || ""}
              onChange={(e) => updateLlm("profileId", e.target.value)}
            >
              <option value="">Default (Settings API key / OpenAI OAuth)</option>
              {form.llm?.useCustom && !form.llm?.profileId ? (
                <option value="" disabled>
                  Custom inline (legacy — pick a profile below to migrate)
                </option>
              ) : null}
              {llmProfiles.map((p) => {
                const id = p._id || p.id;
                return (
                  <option key={id} value={id}>
                    {p.name}
                    {p.model ? ` · ${p.model}` : ""}
                  </option>
                );
              })}
            </select>
          </label>
          {llmProfiles.length === 0 ? (
            <p className="text-xs text-teal-900/60">
              No saved LLMs yet.{" "}
              <Link to="/settings/llms" className="font-semibold text-teal-800 underline">
                Create an LLM profile
              </Link>{" "}
              with API key, base URL, model, and Test.
            </p>
          ) : null}
          {!isNew ? (
            <ButtonWithHelp helpId="agent.llm.test">
              <button
                type="button"
                disabled={busy}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-teal-200 bg-teal-50 px-3 text-sm font-semibold text-teal-900 disabled:opacity-50 sm:w-auto"
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  setOkMsg("");
                  try {
                    const payload = {
                      ...form,
                      group: form.group || null,
                      facts: form.facts.filter((f) => f.key.trim()),
                      allowedDomains: form.allowedDomains,
                      llm: {
                        profileId: form.llm?.profileId || "",
                        useCustom: Boolean(!form.llm?.profileId && form.llm?.useCustom),
                      },
                    };
                    const saved = await api(`/api/agents/${agentId}`, {
                      method: "PUT",
                      body: JSON.stringify(payload),
                    });
                    setForm((prev) => ({
                      ...prev,
                      llm: {
                        profileId: saved?.agent?.llm?.profileId || "",
                        useCustom: Boolean(
                          saved?.agent?.llm?.useCustom && !saved?.agent?.llm?.profileId
                        ),
                      },
                    }));
                    const data = await api(`/api/agents/${agentId}/llm/test`, {
                      method: "POST",
                      body: JSON.stringify({}),
                    });
                    const preview = data.preview ? ` Reply: “${data.preview}”.` : "";
                    const src =
                      data.source === "profile"
                        ? data.profileName
                          ? ` (profile: ${data.profileName})`
                          : " (profile)"
                        : data.source === "settings"
                          ? " (Settings default)"
                          : "";
                    setOkMsg(
                      `${data.message || "Agent LLM connected."} Model: ${data.model || ""}${src}.${preview}`
                    );
                  } catch (err) {
                    setError(err);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Saving & testing…" : "Save & test LLM"}
              </button>
            </ButtonWithHelp>
          ) : (
            <p className="text-xs text-teal-900/60">
              Save the agent first, then you can test the selected LLM.
            </p>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-3 rounded-xl border border-teal-100 bg-white p-3">
          <legend className="px-1">
            <SectionTitle helpId="agent.email.enabled" as="div" className="text-sm font-semibold text-teal-900">
              Email (SMTP)
            </SectionTitle>
          </legend>
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
            <FieldLabel helpId="agent.email.enabled">Enable email for this agent</FieldLabel>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <FieldLabel helpId="agent.email.fromName">From name</FieldLabel>
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                value={form.email?.fromName || ""}
                onChange={(e) => updateEmail("fromName", e.target.value)}
                placeholder="Alex Rivera"
                disabled={!form.email?.enabled}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <FieldLabel helpId="agent.email.fromAddress">From address</FieldLabel>
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
              <FieldLabel helpId="agent.email.smtpHost">SMTP host</FieldLabel>
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                value={form.email?.smtpHost || ""}
                onChange={(e) => updateEmail("smtpHost", e.target.value)}
                placeholder="smtp.gmail.com"
                disabled={!form.email?.enabled}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <FieldLabel helpId="agent.email.smtpPort">SMTP port</FieldLabel>
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                type="number"
                value={form.email?.smtpPort ?? 587}
                onChange={(e) => updateEmail("smtpPort", Number(e.target.value) || 587)}
                disabled={!form.email?.enabled}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <FieldLabel helpId="agent.email.smtpUser">SMTP username</FieldLabel>
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                value={form.email?.smtpUser || ""}
                onChange={(e) => updateEmail("smtpUser", e.target.value)}
                placeholder="usually same as from address"
                disabled={!form.email?.enabled}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <FieldLabel helpId="agent.email.smtpPassword">SMTP password</FieldLabel>
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
              <FieldLabel helpId="agent.email.imapHost">IMAP host (inbox)</FieldLabel>
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                value={form.email?.imapHost || ""}
                onChange={(e) => updateEmail("imapHost", e.target.value)}
                placeholder="imap.gmail.com (optional if smtp.* → imap.*)"
                disabled={!form.email?.enabled}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <FieldLabel helpId="agent.email.imapPort">IMAP port</FieldLabel>
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
            <FieldLabel helpId="agent.email.smtpSecure">SMTP TLS on connect (port 465)</FieldLabel>
          </label>
          {!isNew ? (
            <ButtonWithHelp helpId="agent.email.test">
              <button
                type="button"
                disabled={busy || !form.email?.enabled}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  setOkMsg("");
                  try {
                    // Why: test reads Mongo, not the open form — save email fields first so Enable/password stick.
                    const payload = {
                      ...form,
                      group: form.group || null,
                      facts: form.facts.filter((f) => f.key.trim()),
                      allowedDomains: form.allowedDomains,
                    };
                    const saved = await api(`/api/agents/${agentId}`, {
                      method: "PUT",
                      body: JSON.stringify(payload),
                    });
                    if (saved?.agent?.email) {
                      setForm((prev) => ({
                        ...prev,
                        email: {
                          ...prev.email,
                          ...saved.agent.email,
                          smtpPassword: "",
                          hasSmtpPassword: Boolean(saved.agent.email.hasSmtpPassword),
                        },
                      }));
                    }
                    await api(`/api/agents/${agentId}/email/test`, {
                      method: "POST",
                      body: JSON.stringify({}),
                    });
                    setOkMsg("Saved email settings and sent a test to the from address.");
                  } catch (err) {
                    setError(err);
                  } finally {
                    setBusy(false);
                  }
                }}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-teal-200 bg-teal-50 px-3 text-sm font-semibold text-teal-900 disabled:opacity-50 sm:w-auto"
              >
                {busy ? "Saving & testing…" : "Save & send test email"}
              </button>
            </ButtonWithHelp>
          ) : (
            <p className="text-xs text-teal-900/60">Save the agent first, then you can send a test email.</p>
          )}
        </fieldset>

        {!isNew ? (
          <div className="flex flex-col gap-2">
            <SectionTitle helpId="agent.liveScreen">Live cloud screen</SectionTitle>
            <LiveScreen agentId={agentId} compact />
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              <ButtonWithHelp helpId="agent.clearBrowserData">
                <button
                  type="button"
                  disabled={busy || clearBusy}
                  onClick={() => void onClearBrowserData()}
                  className="min-h-11 rounded-xl border border-amber-300 bg-white px-4 text-sm font-semibold text-amber-950 disabled:opacity-50"
                >
                  {clearBusy ? "Clearing…" : "Clear cookies, cache & downloads"}
                </button>
              </ButtonWithHelp>
              {clearNotice ? (
                <p className="text-xs text-teal-800">{clearNotice}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="agent.startUrl">Start URL (optional)</FieldLabel>
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.startUrl}
            onChange={(e) => update("startUrl", e.target.value)}
            placeholder="Optional — leave empty for blank page"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="agent.allowedDomains">
            Allowed domains (comma-separated, empty = any)
          </FieldLabel>
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={form.allowedDomains}
            onChange={(e) => update("allowedDomains", e.target.value)}
            placeholder="news.google.com, reuters.com"
          />
        </label>

        <div>
          <SectionTitle helpId="agent.facts" className="mb-2">
            Facts
          </SectionTitle>
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
            <ButtonWithHelp helpId="agent.facts.add">
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
            </ButtonWithHelp>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-teal-100 pt-3">
          <SectionTitle helpId="agent.role">Workforce role</SectionTitle>
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="agent.role">Role</FieldLabel>
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
              <FieldLabel helpId="agent.managedAgents">Managed agents</FieldLabel>
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
            <FieldLabel helpId="agent.policy.requireApproval">
              Agent policy: require Governance approval before submit
            </FieldLabel>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="agent.policy.monthlyBudget">
              Agent monthly budget (USD, 0 = use org default)
            </FieldLabel>
            <input
              type="number"
              min={0}
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              value={form.policy.monthlyBudgetUsd}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  policy: { ...prev.policy, monthlyBudgetUsd: e.target.value },
                }))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="agent.policy.dailyBudget">Agent daily budget (USD)</FieldLabel>
            <input
              type="number"
              min={0}
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              value={form.policy.dailyBudgetUsd}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  policy: { ...prev.policy, dailyBudgetUsd: e.target.value },
                }))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="agent.policy.maxTaskMinutes">Max task duration (minutes)</FieldLabel>
            <input
              type="number"
              min={0}
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              value={form.policy.maxTaskMinutes}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  policy: { ...prev.policy, maxTaskMinutes: e.target.value },
                }))
              }
            />
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
              <FieldLabel helpId={`agent.autonomy.${key}`}>{label}</FieldLabel>
            </label>
          ))}
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(form.active)}
              onChange={(e) => update("active", e.target.checked)}
            />
            <FieldLabel helpId="agent.active">Active</FieldLabel>
          </label>
        </div>

        {!isNew ? (
          <div className="flex flex-col gap-2 border-t border-teal-100 pt-3">
            <SectionTitle helpId="agent.memory">Memory</SectionTitle>
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
          <ButtonWithHelp helpId="agent.save">
            <button
              type="submit"
              disabled={busy}
              className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save agent"}
            </button>
          </ButtonWithHelp>
          {!isNew ? (
            <ButtonWithHelp helpId="agent.delete">
              <button
                type="button"
                disabled={busy}
                onClick={onDelete}
                className="min-h-11 rounded-xl border border-red-200 bg-red-50 px-4 font-semibold text-red-700"
              >
                Delete
              </button>
            </ButtonWithHelp>
          ) : null}
        </div>
      </form>
    </div>
  );
}
