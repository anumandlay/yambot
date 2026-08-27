/**
 * @fileoverview Company dashboard — entities, memory, processes, campaigns, email, OS view.
 * Purpose: Company brain UI for Phases 1–4 (world model + campaigns + dashboard).
 * Downstream: entities, company-memory, processes, campaigns, company-dashboard APIs.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { ButtonWithHelp, FieldLabel, PageGuideBanner } from "../components/FieldLabel.jsx";

export function CompanyPage() {
  const [tab, setTab] = useState("dashboard");
  const [entities, setEntities] = useState([]);
  const [memories, setMemories] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [processInstances, setProcessInstances] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [emailLog, setEmailLog] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [agents, setAgents] = useState([]);
  const [agentGroups, setAgentGroups] = useState([]);
  const [entityGroupFilter, setEntityGroupFilter] = useState("");
  const [entityFormGroupId, setEntityFormGroupId] = useState("");
  const [entityKindFilter, setEntityKindFilter] = useState("");
  const [entityListType, setEntityListType] = useState("lead");
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState("");

  const [entityName, setEntityName] = useState("");
  const [entityEmail, setEntityEmail] = useState("");
  const [entityType, setEntityType] = useState("lead");
  const [memoryKey, setMemoryKey] = useState("");
  const [memoryValue, setMemoryValue] = useState("");
  const [processName, setProcessName] = useState("");
  const [editingProcessId, setEditingProcessId] = useState("");
  const [stageJson, setStageJson] = useState("");
  const [bottlenecks, setBottlenecks] = useState([]);
  const [teams, setTeams] = useState([]);
  const [teamName, setTeamName] = useState("");

  const [campaignName, setCampaignName] = useState("");
  const [campaignAgentId, setCampaignAgentId] = useState("");
  const [campaignSubject, setCampaignSubject] = useState("Hello {{name}}");
  const [campaignBody, setCampaignBody] = useState(
    "Hi {{name}},\n\nI wanted to reach out about…\n\nBest"
  );
  const [selectedCampaignId, setSelectedCampaignId] = useState("");

  const [entityTotal, setEntityTotal] = useState(0);
  const [leadStats, setLeadStats] = useState({ total: 0, withEmail: 0 });
  const [csvText, setCsvText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [enrollBusy, setEnrollBusy] = useState(null);

  const load = useCallback(async () => {
    const groupQs =
      entityGroupFilter === "ungrouped"
        ? "&groupId=ungrouped"
        : entityGroupFilter
          ? `&groupId=${encodeURIComponent(entityGroupFilter)}`
          : "";
    const typeQs =
      entityListType && entityListType !== "all" ? `&type=${encodeURIComponent(entityListType)}` : "";
    const kindQs = entityKindFilter.trim()
      ? `&kind=${encodeURIComponent(entityKindFilter.trim())}`
      : "";
    const [ent, mem, proc, dash, camp, agentData, groupData, inst, mail, stats, teamData] =
      await Promise.all([
        api(`/api/entities?limit=500${typeQs}${groupQs}${kindQs}`),
        api("/api/company-memory"),
        api("/api/processes/definitions"),
        api("/api/company-dashboard").catch(() => ({ dashboard: null })),
        api("/api/campaigns").catch(() => ({ campaigns: [] })),
        api("/api/agents"),
        api("/api/groups?type=agent").catch(() => ({ groups: [] })),
        api("/api/company-dashboard/process-instances").catch(() => ({ instances: [] })),
        api("/api/company-dashboard/email?limit=30").catch(() => ({ messages: [] })),
        api(`/api/entities/stats?type=lead${groupQs}`).catch(() => ({ total: 0, withEmail: 0 })),
        api("/api/teams").catch(() => ({ teams: [] })),
      ]);
    setEntities(ent.entities || []);
    setEntityTotal(ent.total ?? (ent.entities || []).length);
    setLeadStats({ total: stats.total || 0, withEmail: stats.withEmail || 0 });
    setTeams(teamData.teams || []);
    setMemories(mem.memories || []);
    setProcesses(proc.definitions || proc.processes || []);
    setDashboard(dash.dashboard || null);
    setCampaigns(camp.campaigns || []);
    setAgents(agentData.agents || []);
    setAgentGroups(groupData.groups || []);
    setProcessInstances(inst.instances || []);
    setEmailLog(mail.messages || []);
  }, [entityGroupFilter, entityKindFilter, entityListType]);

  useEffect(() => {
    load().catch((err) => setError(err));
  }, [load]);

  useEffect(() => {
    if (!agents.length) return;
    setCampaignAgentId((prev) => prev || String(agents[0]._id));
  }, [agents]);

  async function loadEnrollments(campaignId) {
    if (!campaignId) {
      setEnrollments([]);
      return;
    }
    const data = await api(`/api/campaigns/${campaignId}/enrollments`);
    setEnrollments(data.enrollments || []);
  }

  useEffect(() => {
    if (selectedCampaignId) loadEnrollments(selectedCampaignId).catch(() => setEnrollments([]));
  }, [selectedCampaignId]);

  async function addEntity(e) {
    e.preventDefault();
    setError(null);
    setOkMsg("");
    try {
      await api("/api/entities", {
        method: "POST",
        body: JSON.stringify({
          name: entityName.trim(),
          type: entityType,
          status: entityType === "lead" ? "new" : "active",
          groupId: entityFormGroupId || null,
          attributes: entityEmail.trim() ? { email: entityEmail.trim() } : {},
        }),
      });
      setEntityName("");
      setEntityEmail("");
      setOkMsg("Entity created.");
      await load();
    } catch (err) {
      setError(err);
    }
  }

  /**
   * @param {string} text
   */
  async function importCsv(text) {
    const csv = String(text || "").trim();
    if (!csv) return;
    setImportBusy(true);
    setError(null);
    setOkMsg("");
    setImportResult(null);
    try {
      const data = await api("/api/entities/import", {
        method: "POST",
        body: JSON.stringify({
          csv,
          entityType: "lead",
          updateExisting: true,
          groupId: entityFormGroupId || null,
        }),
        timeoutMs: 120000,
      });
      setImportResult(data);
      setCsvText("");
      const parts = [
        `${data.totalRows ?? "?"} row(s)`,
        `${data.uniqueEmails ?? "?"} unique email(s)`,
        `${data.created || 0} created`,
        `${data.updated || 0} updated`,
      ];
      if (data.skipped) parts.push(`${data.skipped} skipped`);
      if (data.duplicatesInFile) parts.push(`${data.duplicatesInFile} duplicate(s) in file`);
      setOkMsg(`Import complete: ${parts.join(", ")}.`);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setImportBusy(false);
    }
  }

  /**
   * @param {import("react").ChangeEvent<HTMLInputElement>} e
   */
  async function onCsvFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const text = await file.text();
    await importCsv(text);
  }

  async function addMemory(e) {
    e.preventDefault();
    setError(null);
    setOkMsg("");
    try {
      await api("/api/company-memory", {
        method: "POST",
        body: JSON.stringify({ key: memoryKey.trim(), value: memoryValue.trim(), category: "fact" }),
      });
      setMemoryKey("");
      setMemoryValue("");
      setOkMsg("Memory saved.");
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function addProcess(e) {
    e.preventDefault();
    setError(null);
    setOkMsg("");
    try {
      await api("/api/processes/definitions", {
        method: "POST",
        body: JSON.stringify({
          name: processName.trim(),
          stages: [{ id: "start", name: "Start" }, { id: "done", name: "Done" }],
        }),
      });
      setProcessName("");
      setOkMsg("Process definition created.");
      await load();
    } catch (err) {
      setError(err);
    }
  }

  /**
   * @param {object} proc
   */
  function startEditProcess(proc) {
    setEditingProcessId(String(proc._id));
    setStageJson(JSON.stringify(proc.stages || [], null, 2));
    api(`/api/processes/definitions/${proc._id}/bottlenecks`)
      .then((data) => setBottlenecks(data.bottlenecks || []))
      .catch(() => setBottlenecks([]));
  }

  async function saveProcessStages() {
    setError(null);
    try {
      const stages = JSON.parse(stageJson);
      if (!Array.isArray(stages)) throw new Error("Stages must be a JSON array");
      await api(`/api/processes/definitions/${editingProcessId}`, {
        method: "PUT",
        body: JSON.stringify({ stages }),
      });
      setOkMsg("Process stages saved.");
      setEditingProcessId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? { title: "Invalid JSON", detail: err.message } : err);
    }
  }

  async function createCampaign(e) {
    e.preventDefault();
    setError(null);
    setOkMsg("");
    try {
      await api("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({
          name: campaignName.trim() || "Outreach campaign",
          agentId: campaignAgentId,
          entityType: "lead",
          emailSubject: campaignSubject,
          emailBody: campaignBody,
          status: "draft",
        }),
      });
      setCampaignName("");
      setOkMsg("Campaign created.");
      await load();
    } catch (err) {
      setError(err);
    }
  }

  /**
   * @param {string} id
   * @param {string} status
   */
  async function setCampaignStatus(id, status) {
    setError(null);
    try {
      await api(`/api/campaigns/${id}`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
      setOkMsg(status === "active" ? "Campaign activated." : "Campaign updated.");
      await load();
    } catch (err) {
      setError(err);
    }
  }

  /**
   * @param {string} id
   */
  async function enrollCampaign(id) {
    setError(null);
    setOkMsg("");
    setEnrollBusy(id);
    try {
      const data = await api(`/api/campaigns/${id}/enroll`, { method: "POST", body: "{}" });
      const parts = [
        `${data.added || 0} newly enrolled`,
        `${data.totalEnrolled ?? "—"} total in campaign`,
      ];
      if (data.remaining > 0) {
        parts.push(`${data.remaining} eligible leads not yet enrolled (missing email?)`);
      } else if (data.totalEligible != null) {
        parts.push(`${data.totalEligible} eligible leads scanned`);
      }
      setOkMsg(`Enroll all: ${parts.join(" · ")}.`);
      setSelectedCampaignId(id);
      await loadEnrollments(id);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setEnrollBusy(null);
    }
  }

  async function addTeam(e) {
    e.preventDefault();
    setError(null);
    try {
      await api("/api/teams", {
        method: "POST",
        body: JSON.stringify({ name: teamName.trim(), defaultForTickets: teams.length === 0 }),
      });
      setTeamName("");
      await load();
    } catch (err) {
      setError(err);
    }
  }

  const tabs = [
    ["dashboard", "Dashboard"],
    ["entities", "Entities"],
    ["campaigns", "Campaigns"],
    ["email", "Email log"],
    ["memory", "Memory"],
    ["processes", "Processes"],
    ["teams", "Teams"],
  ];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Company</h1>
        <p className="text-sm text-teal-900/70">
          World model, campaigns, email audit trail, and operating dashboard — agents read/write this
          during runs.
        </p>
      </div>

      <PageGuideBanner helpId="company.page" />

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}
      {okMsg ? <p className="text-sm font-semibold text-teal-800">{okMsg}</p> : null}

      <div className="flex flex-wrap gap-2">
        {tabs.map(([id, label]) => (
          <ButtonWithHelp key={id} helpId={`company.${id}`}>
            <button
              type="button"
              onClick={() => setTab(id)}
              className={`min-h-10 rounded-xl px-3 text-sm font-semibold ${
                tab === id ? "bg-teal-700 text-white" : "border border-teal-100 bg-white text-teal-900"
              }`}
            >
              {label}
            </button>
          </ButtonWithHelp>
        ))}
      </div>

      {tab === "dashboard" && dashboard ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-bold text-teal-900">Entities</h2>
            <ul className="mt-2 text-sm text-teal-900/80">
              {(dashboard.entitiesByType || []).map((r) => (
                <li key={r.type}>
                  {r.type}: {r.count}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-bold text-teal-900">Campaign funnel</h2>
            <ul className="mt-2 text-sm text-teal-900/80">
              {(dashboard.enrollmentsByStage || []).map((r) => (
                <li key={r.stage}>
                  {r.stage}: {r.count}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm sm:col-span-2">
            <h2 className="text-sm font-bold text-teal-900">Agent workload</h2>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {(dashboard.agentWorkload || []).map((a) => (
                <li key={a._id} className="flex justify-between rounded-lg bg-teal-50/50 px-2 py-1">
                  <span>
                    {a.name}{" "}
                    <span className={a.online ? "text-emerald-700" : "text-teal-900/50"}>
                      {a.online ? "online" : "offline"}
                    </span>
                  </span>
                  <span className="text-teal-900/70">{a.pendingTasks} queued</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm sm:col-span-2">
            <h2 className="text-sm font-bold text-teal-900">Active process instances</h2>
            <ul className="mt-2 text-sm text-teal-900/80">
              {(dashboard.activeProcessInstances || []).length ? (
                dashboard.activeProcessInstances.map((p) => (
                  <li key={p._id}>
                    {p.definition} · {p.entity || "—"} · stage {p.currentStage}
                  </li>
                ))
              ) : (
                <li>None — agents can start_process during runs.</li>
              )}
            </ul>
          </div>
        </div>
      ) : null}

      {tab === "entities" ? (
        <div className="flex flex-col gap-3">
          <div className="rounded-2xl border border-teal-100 bg-teal-50/40 p-4 text-sm text-teal-900/80">
            <strong>{leadStats.total}</strong> leads · <strong>{leadStats.withEmail}</strong> with
            email (campaign-ready)
            {entityTotal > entities.length ? (
              <span className="text-teal-900/60"> · showing latest {entities.length}</span>
            ) : null}
            <p className="mt-1 text-xs text-teal-900/65">
              Territory = agent group (e.g. USA). Agents in that group share this lead DB; other
              countries cannot see it.
            </p>
          </div>

          <label className="flex max-w-md flex-col gap-1 text-sm">
            <FieldLabel helpId="company.territoryFilter">Territory filter</FieldLabel>
            <select
              className="min-h-11 rounded-xl border border-teal-100 bg-white px-3 text-sm"
              value={entityGroupFilter}
              onChange={(e) => setEntityGroupFilter(e.target.value)}
            >
              <option value="">All territories</option>
              <option value="ungrouped">Ungrouped</option>
              {agentGroups.map((g) => (
                <option key={g._id} value={g._id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap gap-3">
            <label className="flex min-w-[8rem] flex-col gap-1 text-sm">
              <span className="font-medium">Type</span>
              <select
                className="min-h-11 rounded-xl border border-teal-100 bg-white px-3 text-sm"
                value={entityListType}
                onChange={(e) => setEntityListType(e.target.value)}
              >
                <option value="lead">lead</option>
                <option value="custom">custom</option>
                <option value="customer">customer</option>
                <option value="all">all types</option>
              </select>
            </label>
            <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-sm">
              <FieldLabel helpId="company.entityKind">Custom table (kind)</FieldLabel>
              <input
                className="min-h-11 rounded-xl border border-teal-100 bg-white px-3 text-sm"
                value={entityKindFilter}
                onChange={(e) => setEntityKindFilter(e.target.value)}
                placeholder="e.g. weather (blank = any)"
              />
            </label>
          </div>

          <div className="flex flex-col gap-2 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <FieldLabel helpId="company.csvImport">Bulk CSV import</FieldLabel>
              <label className="cursor-pointer text-xs font-semibold text-teal-800 underline">
                Choose file
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={onCsvFile} />
              </label>
            </div>
            <p className="text-xs text-teal-900/60">
              Imports into the territory selected below for Add/Import. Header row optional. Columns:{" "}
              <code className="font-mono text-xs">email,name,company</code> or{" "}
              <code className="font-mono text-xs">name,type,email</code> (up to 10,000 rows).
            </p>
            <label className="flex max-w-md flex-col gap-1 text-sm">
              <span className="font-medium">Import / add into territory</span>
              <select
                className="min-h-11 rounded-xl border border-teal-100 px-3 text-sm"
                value={entityFormGroupId}
                onChange={(e) => setEntityFormGroupId(e.target.value)}
              >
                <option value="">Ungrouped</option>
                {agentGroups.map((g) => (
                  <option key={g._id} value={g._id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <textarea
              className="min-h-28 rounded-xl border border-teal-100 px-3 py-2 font-mono text-xs"
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={
                "name,type,email\nSunrise Travel,lead,support@vughy.com\n\nor:\n\nemail,name,company\njane@example.com,Jane Doe,Acme Inc"
              }
            />
            <button
              type="button"
              disabled={importBusy || !csvText.trim()}
              onClick={() => importCsv(csvText)}
              className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50"
            >
              {importBusy ? "Importing…" : "Import leads"}
            </button>
            {importResult?.errors?.length ? (
              <ul className="text-xs text-amber-900">
                {importResult.errors.slice(0, 8).map((msg, i) => (
                  <li key={i}>{msg}</li>
                ))}
                {importResult.errors.length > 8 ? (
                  <li>…and {importResult.errors.length - 8} more</li>
                ) : null}
              </ul>
            ) : null}
          </div>

          <form
            onSubmit={addEntity}
            className="flex flex-col gap-2 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm sm:flex-row sm:flex-wrap sm:items-end"
          >
            <label className="flex flex-col gap-1 text-sm">
              <FieldLabel helpId="company.entityName">Name</FieldLabel>
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3 text-sm"
                value={entityName}
                onChange={(e) => setEntityName(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Type</span>
              <select
                className="min-h-11 rounded-xl border border-teal-100 px-3 text-sm"
                value={entityType}
                onChange={(e) => setEntityType(e.target.value)}
              >
                <option value="lead">lead</option>
                <option value="customer">customer</option>
                <option value="vendor">vendor</option>
              </select>
            </label>
            <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-sm">
              <span className="font-medium">Email</span>
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3 text-sm"
                value={entityEmail}
                onChange={(e) => setEntityEmail(e.target.value)}
                placeholder="for reply matching"
              />
            </label>
            <button type="submit" className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white">
              Add
            </button>
          </form>
          <ul className="flex flex-col gap-2">
            {entities.map((en) => (
              <li key={en._id} className="rounded-xl border border-teal-100 bg-white p-3 text-sm">
                <div className="font-semibold">{en.name}</div>
                <div className="text-teal-900/70">
                  {en.type}
                  {en.kind ? `/${en.kind}` : ""} · {en.status}
                  {en.group?.name || en.group
                    ? ` · ${en.group?.name || "territory"}`
                    : " · ungrouped"}
                  {en.attributes?.email ? ` · ${en.attributes.email}` : ""}
                  {en.attributes?.phone ? ` · ${en.attributes.phone}` : ""}
                </div>
                {en.observations?.length ? (
                  <div className="mt-1 line-clamp-2 text-xs text-teal-900/50">
                    Latest: {en.observations[en.observations.length - 1]?.content}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "campaigns" ? (
        <div className="flex flex-col gap-3">
          <form onSubmit={createCampaign} className="flex flex-col gap-2 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
            <label className="flex flex-col gap-1 text-sm">
              <FieldLabel helpId="company.campaignName">Campaign name</FieldLabel>
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="Q1 outreach"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Agent</span>
              <select
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                value={campaignAgentId}
                onChange={(e) => setCampaignAgentId(e.target.value)}
              >
                {agents.map((a) => (
                  <option key={a._id} value={a._id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Email subject</span>
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3 font-mono text-sm"
                value={campaignSubject}
                onChange={(e) => setCampaignSubject(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Email body</span>
              <textarea
                className="min-h-24 rounded-xl border border-teal-100 px-3 py-2 text-sm"
                value={campaignBody}
                onChange={(e) => setCampaignBody(e.target.value)}
              />
            </label>
            <button type="submit" className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white">
              Create campaign
            </button>
          </form>
          <ul className="flex flex-col gap-2">
            {campaigns.map((c) => (
              <li key={c._id} className="rounded-xl border border-teal-100 bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold">{c.name}</div>
                  <span className="rounded bg-teal-50 px-2 py-0.5 text-xs uppercase">{c.status}</span>
                </div>
                <div className="mt-1 text-xs text-teal-900/60">
                  Enrolled {c.stats?.enrolled || 0} · Sent {c.stats?.sent || 0} · Replied{" "}
                  {c.stats?.replied || 0}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={enrollBusy === String(c._id)}
                    onClick={() => enrollCampaign(String(c._id))}
                    className="text-xs font-semibold text-teal-800 underline disabled:opacity-50"
                  >
                    {enrollBusy === String(c._id) ? "Enrolling…" : "Enroll all leads"}
                  </button>
                  {c.status !== "active" ? (
                    <button
                      type="button"
                      onClick={() => setCampaignStatus(String(c._id), "active")}
                      className="text-xs font-semibold text-emerald-800 underline"
                    >
                      Activate
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setCampaignStatus(String(c._id), "paused")}
                      className="text-xs font-semibold text-amber-800 underline"
                    >
                      Pause
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedCampaignId(String(c._id))}
                    className="text-xs font-semibold text-violet-800 underline"
                  >
                    View enrollments
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {selectedCampaignId ? (
            <div className="rounded-xl border border-violet-100 bg-violet-50/30 p-3">
              <h3 className="text-sm font-bold">
                Enrollments {enrollments.length ? `(${enrollments.length} shown)` : ""}
              </h3>
              {enrollments.length ? (
                <ul className="mt-2 flex flex-col gap-1 text-xs">
                  {enrollments.map((e) => (
                    <li key={e._id}>
                      {e.entity?.name || e.entity} · {e.stage}
                      {e.nextActionAt ? ` · next ${new Date(e.nextActionAt).toLocaleString()}` : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-teal-900/60">No enrollments yet — use Enroll all leads.</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "email" ? (
        <ul className="flex flex-col gap-2">
          {emailLog.length === 0 ? (
            <li className="rounded-xl border border-dashed border-teal-200 p-4 text-sm text-teal-900/60">
              No email logged yet. Configure agent SMTP/IMAP and send or poll inbox.
            </li>
          ) : (
            emailLog.map((m) => (
              <li key={m._id} className="rounded-xl border border-teal-100 bg-white p-3 text-sm">
                <div className="font-semibold">
                  {m.direction === "outbound" ? "→" : "←"} {m.subject}
                </div>
                <div className="text-xs text-teal-900/60">
                  {m.from} → {m.to} · {m.createdAt ? new Date(m.createdAt).toLocaleString() : ""}
                </div>
              </li>
            ))
          )}
        </ul>
      ) : null}

      {tab === "memory" ? (
        <div className="flex flex-col gap-3">
          <form
            onSubmit={addMemory}
            className="flex flex-col gap-2 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm sm:flex-row"
          >
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
              <FieldLabel helpId="company.memoryKey">Key</FieldLabel>
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3 text-sm"
                value={memoryKey}
                onChange={(e) => setMemoryKey(e.target.value)}
              />
            </label>
            <label className="flex min-w-0 flex-[2] flex-col gap-1 text-sm">
              <FieldLabel helpId="company.memoryValue">Value / fact</FieldLabel>
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3 text-sm"
                value={memoryValue}
                onChange={(e) => setMemoryValue(e.target.value)}
              />
            </label>
            <button type="submit" className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white">
              Save
            </button>
          </form>
          <ul className="flex flex-col gap-2">
            {memories.map((m) => (
              <li key={m._id} className="rounded-xl border border-teal-100 bg-white p-3 text-sm">
                <div className="font-semibold">{m.key}</div>
                <div className="text-teal-900/70">{m.value}</div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "processes" ? (
        <div className="flex flex-col gap-3">
          <form onSubmit={addProcess} className="flex gap-2 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
              <FieldLabel helpId="company.processName">Process name</FieldLabel>
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3 text-sm"
                value={processName}
                onChange={(e) => setProcessName(e.target.value)}
              />
            </label>
            <button type="submit" className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white">
              Add
            </button>
          </form>
          <ul className="flex flex-col gap-2">
            {processes.map((p) => (
              <li key={p._id} className="rounded-xl border border-teal-100 bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-teal-900/70">{p.stages?.length || 0} stages</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => startEditProcess(p)}
                    className="text-xs font-semibold text-teal-800 underline"
                  >
                    Edit stages
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {editingProcessId ? (
            <div className="rounded-xl border border-violet-100 bg-violet-50/30 p-3">
              <h3 className="text-sm font-bold">Stage editor</h3>
              <p className="mt-1 text-xs text-teal-900/60">
                JSON array: [{"{"}id, name, description{"}"}, …]
              </p>
              <textarea
                className="mt-2 min-h-40 w-full rounded-xl border border-teal-100 px-3 py-2 font-mono text-xs"
                value={stageJson}
                onChange={(e) => setStageJson(e.target.value)}
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={saveProcessStages}
                  className="min-h-10 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white"
                >
                  Save stages
                </button>
                <button
                  type="button"
                  onClick={() => setEditingProcessId("")}
                  className="min-h-10 rounded-xl border border-teal-100 px-4 text-sm"
                >
                  Cancel
                </button>
              </div>
              {bottlenecks.length ? (
                <div className="mt-3">
                  <h4 className="text-xs font-bold">Bottlenecks (active instances)</h4>
                  <ul className="mt-1 text-xs text-teal-900/70">
                    {bottlenecks.map((b) => (
                      <li key={b.stage}>
                        {b.stage}: {b.count}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
          {processInstances.length ? (
            <div className="rounded-xl border border-teal-50 bg-teal-50/30 p-3">
              <h3 className="text-sm font-bold">Running instances</h3>
              <ul className="mt-2 text-xs">
                {processInstances.map((pi) => (
                  <li key={pi._id}>
                    {pi.definition?.name} · {pi.entity?.name || "—"} · {pi.currentStage} ({pi.status})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "teams" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-teal-900/70">
            Teams enable round-robin ticket assignment. Set default support agent in Company Memory key{" "}
            <code className="text-xs">default_support_agent_id</code>.
          </p>
          <form onSubmit={addTeam} className="flex gap-2 rounded-2xl border border-teal-100 bg-white p-4">
            <input
              className="min-h-11 flex-1 rounded-xl border px-3 text-sm"
              placeholder="Team name"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
            />
            <button type="submit" className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white">
              Add team
            </button>
          </form>
          <ul className="flex flex-col gap-2">
            {teams.map((team) => (
              <li key={team._id} className="rounded-xl border border-teal-100 bg-white p-3 text-sm">
                <div className="font-semibold">{team.name}</div>
                <div className="text-xs text-teal-900/60">
                  {team.memberAgents?.length || 0} agents
                  {team.defaultForTickets ? " · default for tickets" : ""}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
