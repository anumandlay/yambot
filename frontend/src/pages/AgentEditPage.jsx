/**
 * @fileoverview Create / edit a YamBot agent definition.
 * Purpose: Capture profile, skill, instructions, facts, autonomy, success criteria.
 * UI: section groups live in same-page tabs (?tab=) so the editor is not one long scroll.
 * Downstream: PUT/POST /api/agents, LiveScreen, Composio connect, schedulers, memory.
 */

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
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
import { AgentAvatar } from "../components/AgentAvatar.jsx";
import { resizeImageFileToAvatar } from "../lib/agentAvatar.js";

const EMPTY = {
  name: "",
  description: "",
  profile: "",
  skill: "",
  avatarMime: "",
  avatarBase64: "",
  instructions: "",
  facts: [{ key: "", value: "" }],
  successCriteria: "",
  allowedDomains: "",
  startUrl: "",
  active: true,
  group: "",
  /** browser = Chromium box; api = no live computer (saves RAM). */
  mode: "browser",
  autonomy: {
    allowSubmit: true,
    allowCaptcha: true,
    askBeforeLogin: true,
    askBeforeSubmit: false,
    visionEnabled: false,
  },
  role: "worker",
  lifecycleStatus: "active",
  authorityLevel: "external",
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
    name: "",
    kind: "computer",
    goal: "",
    interval: "1h",
    dailyAt: "09:00",
    oneShotAt: null,
    repeatLimit: null,
    repeatRemaining: null,
    agentRun: true,
    lastRunAt: null,
    nextRunAt: null,
    chatId: null,
  },
  /** Multiple cron jobs — primary source of truth in the editor. */
  schedules: [
    {
      name: "",
      enabled: false,
      kind: "computer",
      goal: "",
      interval: "1h",
      dailyAt: "09:00",
      oneShotAt: null,
      repeatLimit: null,
      repeatRemaining: null,
      agentRun: true,
      lastRunAt: null,
      nextRunAt: null,
      chatId: null,
    },
  ],
  llm: {
    profileId: "",
    visionProfileId: "",
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
  /**
   * Composio — per-agent API key + selected apps (OAuth stays in Composio).
   */
  composio: {
    enabled: false,
    apiKey: "",
    hasApiKey: false,
    toolkitSlugs: [],
  },
  /**
   * Desktop engine is always Playwright Chromium (CUA removed from product UI).
   */
  computerEngine: "playwright",
};

/**
 * Human-readable byte size for agent browser data.
 * @param {number|null|undefined} n
 * @returns {string}
 */
function formatBytes(n) {
  const v = Math.max(0, Number(n) || 0);
  if (v < 1024) return `${Math.round(v)} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  return `${(v / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Editor tabs — one section group per tab (same page, no navigation away). */
const AGENT_EDIT_TABS = [
  { id: "basics", label: "Basics" },
  { id: "computer", label: "Computer" },
  { id: "schedulers", label: "Schedulers" },
  { id: "llm", label: "LLM" },
  { id: "email", label: "Email" },
  { id: "composio", label: "Composio" },
  { id: "advanced", label: "Team & policy" },
  { id: "memory", label: "Memory", editOnly: true },
];

export function AgentEditPage() {
  const { agentId } = useParams();
  const isNew = !agentId || agentId === "new";
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const editTabRaw = String(searchParams.get("tab") || "basics").trim().toLowerCase();
  const editTab = AGENT_EDIT_TABS.some((t) => t.id === editTabRaw && (!t.editOnly || !isNew))
    ? editTabRaw
    : "basics";

  /**
   * Switch editor tab without leaving the page (preserves form state).
   * @param {string} id
   */
  function setEditTab(id) {
    const next = String(id || "basics");
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (next === "basics") n.delete("tab");
        else n.set("tab", next);
        return n;
      },
      { replace: true }
    );
  }

  const [form, setForm] = useState(EMPTY);
  const [jobBrief, setJobBrief] = useState("");
  const [draftBusy, setDraftBusy] = useState(false);
  const [scheduleIntervals, setScheduleIntervals] = useState([
    "once",
    "1m",
    "2m",
    "5m",
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
  const [copyBusy, setCopyBusy] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearNotice, setClearNotice] = useState("");
  /** @type {[null|{cookiesBytes:number,cacheBytes:number,downloadsBytes:number,otherBytes:number,totalBytes:number,measuredAt?:string}, Function]} */
  const [browserData, setBrowserData] = useState(null);
  const [okMsg, setOkMsg] = useState("");
  const [memoryNote, setMemoryNote] = useState("");
  const [memory, setMemory] = useState([]);
  const [allAgents, setAllAgents] = useState([]);
  const [agentGroups, setAgentGroups] = useState([]);
  const [llmProfiles, setLlmProfiles] = useState([]);
  const [walletInfo, setWalletInfo] = useState({ balanceUsd: 0, agentPriceUsd: 0 });
  const [readiness, setReadiness] = useState(null);
  /** @type {[Array<{slug:string,label:string,blurb?:string}>, Function]} */
  const [composioCatalog, setComposioCatalog] = useState([]);
  const [composioCatalogBusy, setComposioCatalogBusy] = useState(false);
  const [composioCatalogError, setComposioCatalogError] = useState("");
  const [composioAppFilter, setComposioAppFilter] = useState("");
  const [composioDropdownOpen, setComposioDropdownOpen] = useState(false);
  /** @type {[Array<{id:string,toolkit:string,status:string,label:string}>, Function]} */
  const [composioConnections, setComposioConnections] = useState([]);
  const [composioStatusBusy, setComposioStatusBusy] = useState(false);
  const [composioConnectBusy, setComposioConnectBusy] = useState("");
  /** @type {[string, React.Dispatch<React.SetStateAction<string>>]} */
  const [composioConnectUrl, setComposioConnectUrl] = useState("");


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
          setReadiness(a.readiness || null);
          const agentsList = await api("/api/agents");
          setAllAgents((agentsList.agents || []).filter((x) => x._id !== agentId));
          setForm({
            name: a.name || "",
            group: a.group ? String(a.group) : "",
            description: a.description || "",
            profile: a.profile || "",
            skill: a.skill || "",
            avatarMime: a.avatarMime || "",
            avatarBase64: a.avatarBase64 || "",
            instructions: a.instructions || "",
            facts: a.facts?.length ? a.facts : [{ key: "", value: "" }],
            successCriteria: a.successCriteria || "",
            allowedDomains: (a.allowedDomains || []).join(", "),
            startUrl: a.startUrl || "",
            active: a.active !== false,
            mode: a.mode === "api" ? "api" : "browser",
            autonomy: {
              allowSubmit: a.autonomy?.allowSubmit !== false,
              allowCaptcha: a.autonomy?.allowCaptcha !== false,
              askBeforeLogin: a.autonomy?.askBeforeLogin === true,
              askBeforeSubmit: a.autonomy?.askBeforeSubmit === true,
              visionEnabled: a.autonomy?.visionEnabled === true,
            },
            role: a.role === "manager" ? "manager" : "worker",
            lifecycleStatus: a.lifecycleStatus || "active",
            authorityLevel: a.authorityLevel || "external",
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
              name: a.schedule?.name || "",
              kind: a.schedule?.kind === "chat_reminder" ? "chat_reminder" : "computer",
              goal: a.schedule?.goal || "",
              interval: a.schedule?.interval || "1h",
              dailyAt: a.schedule?.dailyAt || "09:00",
              oneShotAt: a.schedule?.oneShotAt || null,
              repeatLimit: a.schedule?.repeatLimit ?? null,
              repeatRemaining: a.schedule?.repeatRemaining ?? null,
              agentRun: a.schedule?.agentRun !== false,
              lastRunAt: a.schedule?.lastRunAt || null,
              nextRunAt: a.schedule?.nextRunAt || null,
              chatId: a.schedule?.chatId || null,
            },
            schedules: (
              Array.isArray(a.schedules) && a.schedules.length
                ? a.schedules
                : a.schedule
                  ? [a.schedule]
                  : [{}]
            ).map((j) => ({
              _id: j._id || undefined,
              name: j.name || "",
              enabled: Boolean(j.enabled),
              kind: j.kind === "chat_reminder" ? "chat_reminder" : "computer",
              goal: j.goal || "",
              interval: j.interval || "1h",
              dailyAt: j.dailyAt || "09:00",
              oneShotAt: j.oneShotAt || null,
              repeatLimit: j.repeatLimit ?? null,
              repeatRemaining: j.repeatRemaining ?? null,
              agentRun: j.agentRun !== false,
              lastRunAt: j.lastRunAt || null,
              nextRunAt: j.nextRunAt || null,
              chatId: j.chatId || null,
            })),
            llm: {
              profileId: a.llm?.profileId || "",
              visionProfileId: a.llm?.visionProfileId || "",
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
            composio: {
              enabled: Boolean(a.composio?.enabled),
              apiKey: "",
              hasApiKey: Boolean(a.composio?.hasApiKey),
              toolkitSlugs: Array.isArray(a.composio?.toolkitSlugs)
                ? a.composio.toolkitSlugs
                : [],
            },
            computerEngine: "playwright",
          });
          setMemory(a.memory || []);
          if (a.computer?.browserData) {
            setBrowserData(a.computer.browserData);
          }
        }
      } catch (err) {
        setError(err);
      }
    })();
  }, [agentId, isNew]);

  // Why: show Connected / Connect for selected Composio apps after the agent is saved.
  useEffect(() => {
    if (isNew || !agentId) return;
    if (!form.composio?.enabled || !form.composio?.hasApiKey) return;
    void refreshComposioStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when enable/key flags change
  }, [agentId, isNew, form.composio?.enabled, form.composio?.hasApiKey]);

  // Why: worker reports sizes on heartbeat — poll live so the Clear section stays current.
  useEffect(() => {
    if (isNew || !agentId) return undefined;
    let cancelled = false;
    async function refreshBrowserData() {
      try {
        const data = await api(`/api/agents/${agentId}/live`);
        if (cancelled) return;
        if (data?.live?.browserData) {
          setBrowserData(data.live.browserData);
        }
      } catch {
        /* silent — edit page should not toast on background size refresh */
      }
    }
    void refreshBrowserData();
    const t = setInterval(() => void refreshBrowserData(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
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

  /**
   * @param {number} index
   * @param {string} key
   * @param {unknown} value
   */
  function updateScheduleJob(index, key, value) {
    setForm((prev) => {
      const list = [...(prev.schedules || [])];
      const cur = { ...(list[index] || {}) };
      cur[key] = value;
      list[index] = cur;
      return {
        ...prev,
        schedules: list,
        // Why: keep legacy schedule mirrored to job 0 for older API readers.
        schedule: index === 0 ? { ...prev.schedule, ...cur } : prev.schedule,
      };
    });
  }

  function addScheduleJob() {
    setForm((prev) => ({
      ...prev,
      schedules: [
        ...(prev.schedules || []),
        {
          name: "",
          enabled: true,
          kind: "computer",
          goal: "",
          interval: "1h",
          dailyAt: "09:00",
          oneShotAt: null,
          repeatLimit: null,
          repeatRemaining: null,
          agentRun: true,
          lastRunAt: null,
          nextRunAt: null,
          chatId: null,
        },
      ],
    }));
  }

  /**
   * @param {number} index
   */
  function removeScheduleJob(index) {
    setForm((prev) => {
      const list = [...(prev.schedules || [])];
      if (list.length <= 1) {
        list[0] = {
          name: "",
          enabled: false,
          kind: "computer",
          goal: "",
          interval: "1h",
          dailyAt: "09:00",
          oneShotAt: null,
          repeatLimit: null,
          repeatRemaining: null,
          agentRun: true,
          lastRunAt: null,
          nextRunAt: null,
          chatId: null,
        };
      } else {
        list.splice(index, 1);
      }
      return {
        ...prev,
        schedules: list,
        schedule: { ...list[0] },
      };
    });
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
  function updateComposio(key, value) {
    setForm((prev) => ({
      ...prev,
      composio: { ...prev.composio, [key]: value },
    }));
  }

  /**
   * Toggle a Composio toolkit slug in the agent allow-list.
   * @param {string} slug
   */
  function toggleComposioToolkit(slug) {
    const s = String(slug || "").trim().toLowerCase();
    if (!s) return;
    setForm((prev) => {
      const cur = Array.isArray(prev.composio?.toolkitSlugs)
        ? [...prev.composio.toolkitSlugs]
        : [];
      const idx = cur.indexOf(s);
      if (idx >= 0) cur.splice(idx, 1);
      else cur.push(s);
      return {
        ...prev,
        composio: { ...prev.composio, toolkitSlugs: cur },
      };
    });
  }

  /**
   * Fetch Composio app catalog using the form key (or saved key via empty body + server fallback).
   */
  async function loadComposioCatalog() {
    setComposioCatalogBusy(true);
    setComposioCatalogError("");
    try {
      const body = {};
      const key = String(form.composio?.apiKey || "").trim();
      if (key) body.apiKey = key;
      else if (!isNew && agentId) body.agentId = agentId;
      const data = await api("/api/agents/composio/catalog", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const list = Array.isArray(data.toolkits) ? data.toolkits : [];
      setComposioCatalog(list);
      if (data.error) setComposioCatalogError(String(data.error));
      setComposioDropdownOpen(true);
    } catch (err) {
      setComposioCatalogError(err?.detail || err?.message || String(err));
      setComposioCatalog([]);
    } finally {
      setComposioCatalogBusy(false);
    }
  }

  /**
   * Refresh OAuth connection status for selected toolkits.
   */
  async function refreshComposioStatus() {
    if (isNew || !agentId) return;
    setComposioStatusBusy(true);
    try {
      const data = await api(`/api/agents/${agentId}/composio/status`);
      setComposioConnections(Array.isArray(data.connections) ? data.connections : []);
    } catch {
      setComposioConnections([]);
    } finally {
      setComposioStatusBusy(false);
    }
  }

  /**
   * Start OAuth for one toolkit.
   * Why: do not open about:blank first (users saw a white tab when authorize failed or was slow).
   * Fetch the URL, then open it — and always show a clickable fallback link.
   * @param {string} toolkit
   */
  async function connectComposioToolkit(toolkit) {
    if (isNew || !agentId) return;
    setError(null);
    setOkMsg("");
    setComposioConnectUrl("");
    setComposioConnectBusy(toolkit);
    try {
      // Persist current app list so Connect works even if the user hasn’t clicked Save yet.
      try {
        await api(`/api/agents/${agentId}`, {
          method: "PUT",
          body: JSON.stringify({
            composio: {
              enabled: Boolean(form.composio?.enabled),
              apiKey: String(form.composio?.apiKey || "").trim(),
              clearApiKey: false,
              toolkitSlugs: Array.isArray(form.composio?.toolkitSlugs)
                ? form.composio.toolkitSlugs
                : [],
            },
          }),
        });
      } catch (saveErr) {
        console.warn("[composio] pre-connect save failed:", saveErr);
      }
      const data = await api(`/api/agents/${agentId}/composio/connect`, {
        method: "POST",
        body: JSON.stringify({ toolkit }),
      });
      const url = String(data.redirectUrl || "").trim();
      if (!url) {
        setError({
          title: "No connect URL",
          detail:
            data.detail ||
            data.message ||
            "Composio did not return a redirect URL for this app. Try Save, then Connect again.",
        });
        return;
      }
      setComposioConnectUrl(url);
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) {
        setOkMsg(
          "Popup blocked — click the Connect link below to authorize, then Refresh status."
        );
      } else {
        setOkMsg(
          data.message ||
            "Opened the connect page. Finish authorizing, then click Refresh status."
        );
      }
    } catch (err) {
      setError(err);
    } finally {
      setComposioConnectBusy("");
    }
  }

  /**
   * @param {string} connectionId
   */
  async function disconnectComposioConnection(connectionId) {
    if (isNew || !agentId || !connectionId) return;
    if (!window.confirm("Disconnect this Composio app?")) return;
    setError(null);
    try {
      await api(
        `/api/agents/${agentId}/composio/connections/${encodeURIComponent(connectionId)}`,
        { method: "DELETE" }
      );
      setOkMsg("Disconnected.");
      await refreshComposioStatus();
    } catch (err) {
      setError(err);
    }
  }

  /**
   * @param {string} slug
   * @returns {object|null}
   */
  function composioConnectionFor(slug) {
    const s = String(slug || "").toLowerCase();
    return (
      composioConnections.find((c) => String(c.toolkit || "").toLowerCase() === s) ||
      null
    );
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
        timeoutMs: 180_000,
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
   * @param {React.FormEvent} e
   */
  async function onSave(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOkMsg("");
    const payload = {
      ...form,
      // Why: product is Playwright-only — never persist CUA from legacy clients/forms.
      computerEngine: "playwright",
      group: form.group || null,
      facts: form.facts.filter((f) => f.key.trim()),
      allowedDomains: form.allowedDomains,
      llm: {
        profileId: form.llm?.profileId || "",
        visionProfileId: form.llm?.visionProfileId || "",
        // Why: preserve pre-profile inline override until the user picks Default or a named profile.
        useCustom: Boolean(!form.llm?.profileId && form.llm?.useCustom),
      },
      email: {
        ...(form.email || {}),
        enabled: Boolean(form.email?.enabled),
        smtpPassword: String(form.email?.smtpPassword || ""),
      },
      composio: {
        enabled: Boolean(form.composio?.enabled),
        apiKey: String(form.composio?.apiKey || "").trim(),
        clearApiKey: false,
        toolkitSlugs: Array.isArray(form.composio?.toolkitSlugs)
          ? form.composio.toolkitSlugs
          : [],
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
                visionProfileId: data.agent.llm.visionProfileId || "",
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
          composio: data?.agent?.composio
            ? {
                enabled: Boolean(data.agent.composio.enabled),
                apiKey: "",
                hasApiKey: Boolean(data.agent.composio.hasApiKey),
                toolkitSlugs: Array.isArray(data.agent.composio.toolkitSlugs)
                  ? data.agent.composio.toolkitSlugs
                  : [],
              }
            : prev.composio,
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
   * Duplicates this agent’s saved configuration into a new agent (new cloud box).
   */
  async function onCopy() {
    if (isNew || !agentId) return;
    if (
      !window.confirm(
        "Copy this agent with the same configuration?\n\nCreates a new agent (and cloud computer). Chats and run history are not copied."
      )
    ) {
      return;
    }
    setCopyBusy(true);
    setError(null);
    try {
      const data = await api(`/api/agents/${agentId}/copy`, { method: "POST" });
      if (data.agent?._id) {
        navigate(`/agents/${data.agent._id}`);
      }
    } catch (err) {
      setError(err);
    } finally {
      setCopyBusy(false);
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
      // Why: sizes drop after the worker finishes; poll a few times so the UI updates soon.
      const pollUntil = Date.now() + 25_000;
      const poll = setInterval(() => {
        if (Date.now() > pollUntil) {
          clearInterval(poll);
          return;
        }
        api(`/api/agents/${agentId}/live`)
          .then((d) => {
            if (d?.live?.browserData) setBrowserData(d.live.browserData);
          })
          .catch(() => {});
      }, 2_500);
    } catch (err) {
      setError(err);
    } finally {
      setClearBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/agents"
          className="inline-flex min-h-11 items-center rounded-xl border border-teal-100 bg-white px-3 text-sm font-semibold"
        >
          ← Agents
        </Link>
        {!isNew && agentId ? (
          <>
            <Link
              to={`/agents/${agentId}/runs`}
              className="inline-flex min-h-11 items-center rounded-xl border border-amber-200 bg-amber-50 px-3 text-sm font-semibold text-amber-950"
            >
              Runs & replies
            </Link>
            <Link
              to={`/agents/${agentId}/memory`}
              className="inline-flex min-h-11 items-center rounded-xl border border-violet-200 bg-violet-50 px-3 text-sm font-semibold text-violet-950"
            >
              View memory
            </Link>
            <ButtonWithHelp helpId="agents.copy">
              <button
                type="button"
                disabled={busy || copyBusy}
                onClick={() => void onCopy()}
                className="inline-flex min-h-11 items-center rounded-xl border border-violet-200 bg-violet-50 px-3 text-sm font-semibold text-violet-950 disabled:opacity-50"
              >
                {copyBusy ? "Copying…" : "Copy"}
              </button>
            </ButtonWithHelp>
          </>
        ) : null}
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

      <div
        className="flex flex-wrap gap-2"
        role="tablist"
        aria-label="Agent editor sections"
      >
        {AGENT_EDIT_TABS.filter((t) => !t.editOnly || !isNew).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={editTab === t.id}
            onClick={() => setEditTab(t.id)}
            className={`min-h-10 rounded-xl px-3 text-sm font-semibold ${
              editTab === t.id
                ? "bg-teal-700 text-white"
                : "border border-teal-100 bg-white text-teal-900"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <form onSubmit={onSave} className="flex flex-col gap-3 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
        {editTab === "basics" ? (
        <div className="flex flex-col gap-3" role="tabpanel">
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

        <div className="flex flex-col gap-2 rounded-xl border border-teal-100 bg-teal-50/40 p-3 sm:flex-row sm:items-center sm:gap-4">
          <AgentAvatar
            agent={{
              name: form.name,
              avatarMime: form.avatarMime,
              avatarBase64: form.avatarBase64,
            }}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <FieldLabel helpId="agent.avatar">Profile picture</FieldLabel>
            <p className="mt-0.5 text-xs text-teal-900/65">
              Square crop, resized automatically. Shown on Agents, Chats, and grok-style.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <label className="inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-teal-200 bg-white px-3 text-sm font-semibold text-teal-900">
                Upload
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    setError(null);
                    try {
                      const { mime, base64 } = await resizeImageFileToAvatar(file);
                      setForm((prev) => ({
                        ...prev,
                        avatarMime: mime,
                        avatarBase64: base64,
                      }));
                    } catch (err) {
                      setError(err);
                    }
                  }}
                />
              </label>
              {form.avatarBase64 ? (
                <button
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      avatarMime: "",
                      avatarBase64: "",
                    }))
                  }
                  className="min-h-11 rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700"
                >
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {readiness ? (
          <div className="rounded-xl border border-teal-100 bg-teal-50/80 p-3 text-sm">
            <div
              className={`font-bold ${
                readiness.score >= 80
                  ? "text-emerald-800"
                  : readiness.score >= 50
                    ? "text-amber-800"
                    : "text-rose-800"
              }`}
            >
              Readiness {readiness.score}%
            </div>
            <ul className="mt-2 space-y-1 text-xs text-teal-900/80">
              {(readiness.checks || []).map((c) => (
                <li key={c.id}>
                  {c.ok ? "✓" : "✗"} {c.label}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
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
        </div>
        ) : null}

        {editTab === "computer" ? (
        <div className="flex flex-col gap-3" role="tabpanel">
        <fieldset className="flex flex-col gap-2 rounded-xl border border-sky-200 bg-sky-50/50 p-3">
          <SectionTitle helpId="agent.needsComputer" className="text-sm font-semibold text-sky-950">
            Live computer
          </SectionTitle>
          <p className="text-xs text-sky-900/75">
            Browser agents get a Chromium box (can also call APIs). API-only agents skip the box to
            save VPS RAM and only run HTTP / email / CRM-style tools.
          </p>
          <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-xl border border-sky-100 bg-white px-3 py-2 text-sm">
            <input
              type="radio"
              className="mt-1"
              name="agent-mode"
              checked={form.mode !== "api"}
              onChange={() => update("mode", "browser")}
            />
            <span>
              <span className="font-semibold text-teal-950">Needs live computer</span>
              <span className="mt-0.5 block text-xs text-teal-800/70">
                Browse websites + APIs (uses ~3 GB RAM for Chromium)
              </span>
            </span>
          </label>
          <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-xl border border-sky-100 bg-white px-3 py-2 text-sm">
            <input
              type="radio"
              className="mt-1"
              name="agent-mode"
              checked={form.mode === "api"}
              onChange={() => update("mode", "api")}
            />
            <span>
              <span className="font-semibold text-teal-950">API only — no live computer</span>
              <span className="mt-0.5 block text-xs text-teal-800/70">
                GET/POST and integrations only (saves RAM; no Live Screen)
              </span>
            </span>
          </label>
        </fieldset>
        {form.mode === "api" ? (
          <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3 text-sm text-sky-950">
            <p className="font-semibold">No live computer for this agent</p>
            <p className="mt-1 text-xs text-sky-900/75">
              Goals run on the API server (HTTP, email, entities, tickets, etc.). Switch to “Needs
              live computer” if you later need browsing.
            </p>
          </div>
        ) : (
        <div className="rounded-xl border-2 border-amber-200 bg-amber-50/70 p-4 text-sm text-teal-900/80">
          <SectionTitle helpId="agent.cloudComputer" className="font-semibold text-teal-900/90">
            Cloud computer
          </SectionTitle>
          <p className="mt-1 text-xs text-teal-900/70">
            Each agent gets a dedicated Playwright Chromium box on the VPS. Use{" "}
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
          <p className="mt-3 rounded-xl border border-amber-200 bg-white/80 px-3 py-2 text-xs text-amber-950">
            <span className="font-semibold">Desktop engine:</span> Playwright Chromium only
            (~3 GB). CUA is not available.
          </p>
          {!isNew ? (
            <div className="mt-3 flex flex-col gap-2 border-t border-amber-200/80 pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-950">
                Browser data
              </p>
              {browserData ? (
                <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-teal-900/80 sm:grid-cols-4">
                  <li>
                    Cookies: <strong className="font-semibold text-teal-950">{formatBytes(browserData.cookiesBytes)}</strong>
                  </li>
                  <li>
                    Cache: <strong className="font-semibold text-teal-950">{formatBytes(browserData.cacheBytes)}</strong>
                  </li>
                  <li>
                    Downloads:{" "}
                    <strong className="font-semibold text-teal-950">
                      {formatBytes(browserData.downloadsBytes)}
                    </strong>
                  </li>
                  <li>
                    Profile total:{" "}
                    <strong className="font-semibold text-teal-950">{formatBytes(browserData.totalBytes)}</strong>
                  </li>
                </ul>
              ) : (
                <p className="text-xs text-amber-900/70">
                  Size appears once the cloud computer heartbeats (usually within ~20s while online).
                </p>
              )}
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
        )}
        </div>
        ) : null}

        {editTab === "schedulers" ? (
        <div className="flex flex-col gap-3" role="tabpanel">
        <fieldset className="flex flex-col gap-3 rounded-xl border border-teal-100 bg-teal-50/40 p-3">
          <legend className="px-1">
            <SectionTitle helpId="agent.schedule.enabled" as="div" className="text-sm font-semibold text-teal-900">
              Schedulers
            </SectionTitle>
          </legend>
          <p className="text-xs text-teal-900/70">
            Computer jobs enqueue a goal when due. Chat reminders post a message in this agent’s
            chat (no browser). A computer tick is skipped if the agent is already busy.
          </p>
          {(form.schedules || []).map((job, index) => (
            <div
              key={job._id || `sched-${index}`}
              className="flex flex-col gap-3 rounded-xl border border-teal-100 bg-white p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex min-h-11 flex-1 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(job.enabled)}
                    onChange={(e) => updateScheduleJob(index, "enabled", e.target.checked)}
                  />
                  <FieldLabel helpId="agent.schedule.enabled">
                    Job {index + 1} enabled
                    {job.kind === "chat_reminder" ? " · reminder" : ""}
                  </FieldLabel>
                </label>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700"
                  onClick={() => removeScheduleJob(index)}
                >
                  {(form.schedules || []).length <= 1 ? "Clear" : "Remove"}
                </button>
              </div>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-semibold text-teal-900">Type</span>
                <select
                  className="min-h-11 rounded-xl border border-teal-100 bg-white px-3"
                  value={job.kind === "chat_reminder" ? "chat_reminder" : "computer"}
                  onChange={(e) => updateScheduleJob(index, "kind", e.target.value)}
                  disabled={!job.enabled}
                >
                  <option value="computer">Computer / Composio goal</option>
                  <option value="chat_reminder">Chat reminder (message only)</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-semibold text-teal-900">Label (optional)</span>
                <input
                  className="min-h-11 rounded-xl border border-teal-100 bg-white px-3"
                  value={job.name || ""}
                  onChange={(e) => updateScheduleJob(index, "name", e.target.value)}
                  placeholder="e.g. Drink water"
                  disabled={!job.enabled}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <FieldLabel helpId="agent.schedule.goal">
                  {job.kind === "chat_reminder" ? "Reminder message" : "Scheduled goal"}
                </FieldLabel>
                <textarea
                  className="min-h-24 rounded-xl border border-teal-100 bg-white px-3 py-2"
                  value={job.goal || ""}
                  onChange={(e) => updateScheduleJob(index, "goal", e.target.value)}
                  placeholder={
                    job.kind === "chat_reminder"
                      ? "Hermes prompt for the tick LLM (e.g. remind me to drink water)…"
                      : "Goal to enqueue automatically…"
                  }
                  disabled={!job.enabled}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <FieldLabel helpId="agent.schedule.interval">Frequency</FieldLabel>
                <input
                  className="min-h-11 rounded-xl border border-teal-100 bg-white px-3"
                  list={`schedule-interval-presets-${index}`}
                  value={job.interval || "1h"}
                  onChange={(e) => {
                    const v = e.target.value.trim().toLowerCase();
                    updateScheduleJob(index, "interval", v || "1h");
                  }}
                  placeholder="e.g. 4m, 70m, 3h, daily, once"
                  disabled={!job.enabled}
                />
                <datalist id={`schedule-interval-presets-${index}`}>
                  {scheduleIntervals.map((iv) => (
                    <option key={iv} value={iv} />
                  ))}
                </datalist>
                <span className="text-xs text-teal-700/80">
                  Any cadence: <code>1m</code>, <code>3m</code>, <code>70m</code>, <code>2h</code>,{" "}
                  <code>daily</code>, or <code>once</code>.
                </span>
              </label>
              {job.kind === "chat_reminder" ? (
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={job.agentRun !== false}
                    onChange={(e) => updateScheduleJob(index, "agentRun", e.target.checked)}
                    disabled={!job.enabled}
                  />
                  <span className="font-semibold text-teal-900">
                    LLM on tick (Hermes) — fresh reply each fire
                  </span>
                </label>
              ) : null}
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-semibold text-teal-900">Repeat limit (optional)</span>
                <input
                  className="min-h-11 rounded-xl border border-teal-100 bg-white px-3"
                  type="number"
                  min={1}
                  max={10000}
                  placeholder="Forever"
                  value={job.repeatLimit ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    updateScheduleJob(index, "repeatLimit", v === "" ? null : Number(v));
                    if (v !== "") updateScheduleJob(index, "repeatRemaining", Number(v));
                  }}
                  disabled={!job.enabled}
                />
                <span className="text-xs text-teal-900/70">
                  Leave empty for forever. Finite N disables after N fires.
                  {job.repeatRemaining != null
                    ? ` Remaining: ${job.repeatRemaining}.`
                    : ""}
                </span>
              </label>
              {job.interval === "once" ? (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-semibold text-teal-900">One-shot time (local → stored)</span>
                  <input
                    className="min-h-11 rounded-xl border border-teal-100 bg-white px-3"
                    type="datetime-local"
                    value={
                      job.oneShotAt
                        ? (() => {
                            const d = new Date(job.oneShotAt);
                            if (Number.isNaN(d.getTime())) return "";
                            const pad = (n) => String(n).padStart(2, "0");
                            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                          })()
                        : ""
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      updateScheduleJob(
                        index,
                        "oneShotAt",
                        v ? new Date(v).toISOString() : null
                      );
                      if (v) updateScheduleJob(index, "nextRunAt", new Date(v).toISOString());
                    }}
                    disabled={!job.enabled}
                  />
                </label>
              ) : null}
              {job.interval === "daily" ? (
                <label className="flex flex-col gap-1 text-sm">
                  <FieldLabel helpId="agent.schedule.dailyAt">Daily time (UTC)</FieldLabel>
                  <input
                    className="min-h-11 rounded-xl border border-teal-100 bg-white px-3"
                    type="time"
                    value={job.dailyAt || "09:00"}
                    onChange={(e) => updateScheduleJob(index, "dailyAt", e.target.value)}
                    disabled={!job.enabled}
                  />
                  <span className="text-xs text-teal-900/70">
                    Stored as UTC. Example: 2:00 PM → set 14:00. Current:{" "}
                    {(() => {
                      const raw = String(job.dailyAt || "09:00");
                      const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
                      if (!m) return raw;
                      const hh = Number(m[1]);
                      const ap = hh >= 12 ? "PM" : "AM";
                      const h12 = hh % 12 || 12;
                      return `${h12}:${m[2]} ${ap} UTC`;
                    })()}
                  </span>
                </label>
              ) : null}
              <div className="grid gap-1 rounded-lg border border-teal-50 bg-teal-50/50 px-3 py-2 text-xs text-teal-900/80 sm:grid-cols-2">
                <p>
                  <span className="font-semibold text-teal-900">Status:</span>{" "}
                  {job.enabled ? "On — will run when due" : "Off — not running"}
                </p>
                <p>
                  <span className="font-semibold text-teal-900">Last run:</span>{" "}
                  {job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : "Never"}
                </p>
                <p className="sm:col-span-2">
                  <span className="font-semibold text-teal-900">Next run:</span>{" "}
                  {job.enabled && job.nextRunAt
                    ? new Date(job.nextRunAt).toLocaleString()
                    : job.enabled
                      ? "Pending (next scheduler tick)"
                      : "— (enable to schedule)"}
                </p>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-teal-200 bg-white px-4 text-sm font-semibold text-teal-900"
            onClick={addScheduleJob}
          >
            + Add another schedule
          </button>
        </fieldset>
        </div>
        ) : null}

        {editTab === "llm" ? (
        <div className="flex flex-col gap-3" role="tabpanel">
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
                        visionProfileId: form.llm?.visionProfileId || "",
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
                        visionProfileId: saved?.agent?.llm?.visionProfileId || "",
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
        </div>
        ) : null}

        {editTab === "email" ? (
        <div className="flex flex-col gap-3" role="tabpanel">
        <fieldset className="flex flex-col gap-3 rounded-xl border border-teal-100 bg-white p-3">
          <legend className="px-1">
            <SectionTitle helpId="agent.email.enabled" as="div" className="text-sm font-semibold text-teal-900">
              Email (SMTP)
            </SectionTitle>
          </legend>
          <p className="text-xs text-teal-900/60">
            Optional agent mailbox for worker send_email / inbox. Turn off to use Composio Gmail
            instead. Password is stored encrypted on the server.
          </p>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-teal-100 bg-teal-50/60 px-3 py-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 shrink-0 accent-teal-700"
              checked={Boolean(form.email?.enabled)}
              onChange={(e) => updateEmail("enabled", e.target.checked)}
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <FieldLabel helpId="agent.email.enabled">Enable agent SMTP</FieldLabel>
              <span className="text-xs text-teal-900/65">
                {form.email?.enabled
                  ? form.email?.configured || form.email?.hasSmtpPassword
                    ? "On — Auto may use this mailbox for send/check email."
                    : "On — fill host, from address, and password below, then Save."
                  : "Off — SMTP ignored; use Composio Gmail for mail in Auto."}
              </span>
            </span>
          </label>
          {form.email?.enabled ? (
          <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <FieldLabel helpId="agent.email.fromName">From name</FieldLabel>
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                value={form.email?.fromName || ""}
                onChange={(e) => updateEmail("fromName", e.target.value)}
                placeholder="Alex Rivera"
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
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <FieldLabel helpId="agent.email.smtpHost">SMTP host</FieldLabel>
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                value={form.email?.smtpHost || ""}
                onChange={(e) => updateEmail("smtpHost", e.target.value)}
                placeholder="smtp.gmail.com"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <FieldLabel helpId="agent.email.smtpPort">SMTP port</FieldLabel>
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                type="number"
                value={form.email?.smtpPort ?? 587}
                onChange={(e) => updateEmail("smtpPort", Number(e.target.value) || 587)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <FieldLabel helpId="agent.email.smtpUser">SMTP username</FieldLabel>
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                value={form.email?.smtpUser || ""}
                onChange={(e) => updateEmail("smtpUser", e.target.value)}
                placeholder="usually same as from address"
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
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <FieldLabel helpId="agent.email.imapPort">IMAP port</FieldLabel>
              <input
                className="min-h-11 rounded-xl border border-teal-100 px-3"
                type="number"
                value={form.email?.imapPort ?? 993}
                onChange={(e) => updateEmail("imapPort", Number(e.target.value) || 993)}
              />
            </label>
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(form.email?.smtpSecure)}
              onChange={(e) => updateEmail("smtpSecure", e.target.checked)}
            />
            <FieldLabel helpId="agent.email.smtpSecure">SMTP TLS on connect (port 465)</FieldLabel>
          </label>
          {!isNew ? (
            <ButtonWithHelp helpId="agent.email.test">
              <button
                type="button"
                disabled={busy}
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
          </>
          ) : null}
        </fieldset>
        </div>
        ) : null}

        {editTab === "composio" ? (
        <div className="flex flex-col gap-3" role="tabpanel">
        <fieldset className="flex flex-col gap-3 rounded-xl border border-teal-100 bg-white/70 p-3 sm:p-4">
          <SectionTitle helpId="agent.composio.enabled" as="div" className="text-sm font-semibold text-teal-900">
            Composio apps
          </SectionTitle>
          <p className="text-xs text-teal-900/70">
            Paste a Composio API key, pick apps, then Connect each app (OAuth). In Auto chat the agent
            can search tools, send connect links, wait for OAuth, and execute — without the browser.
          </p>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(form.composio?.enabled)}
              onChange={(e) => updateComposio("enabled", e.target.checked)}
            />
            <FieldLabel helpId="agent.composio.enabled">Enable Composio for this agent</FieldLabel>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FieldLabel helpId="agent.composio.apiKey">Composio API key</FieldLabel>
              <input
                className="mt-1 w-full rounded-xl border border-teal-200 bg-white px-3 py-2.5 text-sm"
                type="password"
                autoComplete="off"
                value={form.composio?.apiKey || ""}
                onChange={(e) => updateComposio("apiKey", e.target.value)}
                placeholder={
                  form.composio?.hasApiKey
                    ? "Saved — leave blank to keep"
                    : "ak_… from app.composio.dev"
                }
                disabled={!form.composio?.enabled}
              />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel helpId="agent.composio.apps">Apps this agent can use</FieldLabel>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!form.composio?.enabled || composioCatalogBusy}
                  onClick={() => loadComposioCatalog()}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-teal-200 bg-teal-50 px-3 text-sm font-semibold text-teal-900 disabled:opacity-50"
                >
                  {composioCatalogBusy ? "Loading apps…" : "Load apps from Composio"}
                </button>
                <button
                  type="button"
                  disabled={!form.composio?.enabled || !composioCatalog.length}
                  onClick={() => setComposioDropdownOpen((o) => !o)}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-teal-200 bg-white px-3 text-sm font-semibold text-teal-900 disabled:opacity-50"
                >
                  {composioDropdownOpen ? "Hide list" : "Show / pick apps"}
                </button>
              </div>
              {composioCatalogError ? (
                <p className="mt-1 text-xs text-amber-800">{composioCatalogError}</p>
              ) : null}
              {(form.composio?.toolkitSlugs || []).length > 0 ? (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-semibold text-teal-900">Selected apps</p>
                    {!isNew ? (
                      <button
                        type="button"
                        disabled={composioStatusBusy || !form.composio?.enabled}
                        onClick={() => void refreshComposioStatus()}
                        className="rounded-lg border border-teal-200 bg-white px-2 py-1 text-xs font-semibold text-teal-900 disabled:opacity-50"
                      >
                        {composioStatusBusy ? "Refreshing…" : "Refresh status"}
                      </button>
                    ) : null}
                  </div>
                  {composioConnectUrl ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                      <p className="font-semibold">Authorize this app</p>
                      <a
                        href={composioConnectUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex min-h-10 items-center rounded-lg bg-teal-700 px-3 text-sm font-semibold text-white"
                      >
                        Open connect page
                      </a>
                      <a
                        href={composioConnectUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 block break-all text-teal-800 underline"
                      >
                        {composioConnectUrl}
                      </a>
                    </div>
                  ) : null}
                  <ul className="flex flex-col gap-2">
                    {(form.composio.toolkitSlugs || []).map((slug) => {
                      const conn = composioConnectionFor(slug);
                      const connected =
                        conn &&
                        /active|connected|success|enabled/i.test(String(conn.status || ""));
                      return (
                        <li
                          key={slug}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-teal-100 bg-white px-3 py-2 text-sm"
                        >
                          <div>
                            <span className="font-semibold text-teal-950">{slug}</span>
                            <span className="ml-2 text-xs text-teal-900/60">
                              {connected
                                ? `Connected (${conn.status})`
                                : conn
                                  ? `Status: ${conn.status}`
                                  : "Not connected"}
                            </span>
                          </div>
                          {!isNew && form.composio?.enabled ? (
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={Boolean(composioConnectBusy)}
                                onClick={() => void connectComposioToolkit(slug)}
                                className="min-h-9 rounded-lg bg-teal-700 px-3 text-xs font-semibold text-white disabled:opacity-50"
                              >
                                {composioConnectBusy === slug
                                  ? "Opening…"
                                  : connected
                                    ? "Reconnect"
                                    : "Connect"}
                              </button>
                              {conn?.id ? (
                                <button
                                  type="button"
                                  onClick={() => void disconnectComposioConnection(conn.id)}
                                  className="min-h-9 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-800"
                                >
                                  Disconnect
                                </button>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-xs text-teal-900/50">Save agent to connect</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                <p className="mt-2 text-xs text-teal-900/60">
                  No apps selected yet — load the catalog and check the ones you want.
                </p>
              )}
              {composioDropdownOpen && form.composio?.enabled ? (
                <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-teal-200 bg-white p-2">
                  <input
                    className="mb-2 w-full rounded-lg border border-teal-100 px-2 py-1.5 text-sm"
                    type="search"
                    placeholder="Filter apps…"
                    value={composioAppFilter}
                    onChange={(e) => setComposioAppFilter(e.target.value)}
                  />
                  <ul className="flex flex-col gap-1">
                    {(composioCatalog.length
                      ? composioCatalog
                      : [
                          { slug: "gmail", label: "Gmail", blurb: "" },
                          { slug: "slack", label: "Slack", blurb: "" },
                          { slug: "googlesheets", label: "Google Sheets", blurb: "" },
                        ]
                    )
                      .filter((t) => {
                        const q = composioAppFilter.trim().toLowerCase();
                        if (!q) return true;
                        return (
                          String(t.slug || "")
                            .toLowerCase()
                            .includes(q) ||
                          String(t.label || "")
                            .toLowerCase()
                            .includes(q)
                        );
                      })
                      .map((t) => {
                        const slug = String(t.slug || "").toLowerCase();
                        const checked = (form.composio?.toolkitSlugs || []).includes(slug);
                        return (
                          <li key={slug}>
                            <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-teal-50">
                              <input
                                type="checkbox"
                                className="mt-1"
                                checked={checked}
                                onChange={() => toggleComposioToolkit(slug)}
                              />
                              <span>
                                <span className="font-medium text-teal-950">{t.label || slug}</span>
                                <span className="ml-1 text-xs text-teal-900/50">({slug})</span>
                                {t.blurb ? (
                                  <span className="block text-xs text-teal-900/60">{t.blurb}</span>
                                ) : null}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </fieldset>
        </div>
        ) : null}

        {editTab === "computer" ? (
        <div className="flex flex-col gap-3" role="tabpanel">
        {!isNew && form.mode !== "api" ? (
          <div className="flex flex-col gap-2">
            <SectionTitle helpId="agent.liveScreen">Live cloud screen</SectionTitle>
            <LiveScreen agentId={agentId} compact />
            <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              {browserData ? (
                <p className="text-xs text-teal-900/80">
                  Cookies {formatBytes(browserData.cookiesBytes)} · Cache{" "}
                  {formatBytes(browserData.cacheBytes)} · Downloads{" "}
                  {formatBytes(browserData.downloadsBytes)} · Profile{" "}
                  {formatBytes(browserData.totalBytes)}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
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
          </div>
        ) : null}
        {!isNew && form.mode === "api" ? (
          <p className="rounded-xl border border-sky-100 bg-sky-50/50 px-3 py-2 text-xs text-sky-900/80">
            Live screen hidden — this agent is API-only (no Chromium box).
          </p>
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
        </div>
        ) : null}

        {editTab === "advanced" ? (
        <div className="flex flex-col gap-3" role="tabpanel">
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
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-teal-950">Employee lifecycle</span>
            <select
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              value={form.lifecycleStatus || "active"}
              onChange={(e) => update("lifecycleStatus", e.target.value)}
            >
              <option value="hire">Hire</option>
              <option value="training">Training</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="retiring">Retiring</option>
              <option value="retired">Retired</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-teal-950">Authority ceiling (this employee)</span>
            <select
              className="min-h-11 rounded-xl border border-teal-100 px-3"
              value={form.authorityLevel || "external"}
              onChange={(e) => update("authorityLevel", e.target.value)}
            >
              <option value="observe">Observe</option>
              <option value="internal">Internal</option>
              <option value="external">External</option>
              <option value="financial">Financial</option>
              <option value="critical">Critical</option>
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
              checked={Boolean(form.autonomy.visionEnabled)}
              onChange={(e) => updateAutonomy("visionEnabled", e.target.checked)}
            />
            <FieldLabel helpId="agent.autonomy.visionEnabled">
              Enable vision screenshots (error recovery on cloud worker)
            </FieldLabel>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <FieldLabel helpId="agent.llm.visionProfile">Vision LLM for this agent</FieldLabel>
            <select
              className="min-h-11 rounded-xl border border-teal-100 bg-white px-3"
              value={form.llm?.visionProfileId || ""}
              onChange={(e) => updateLlm("visionProfileId", e.target.value)}
              disabled={!form.autonomy.visionEnabled}
            >
              <option value="">Default (Settings vision profile)</option>
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
          <p className="text-xs text-teal-900/60">
            Only used when vision screenshots are enabled. Empty = Settings → default vision LLM
            profile. Manage profiles under{" "}
            <Link to="/settings/llms" className="font-semibold text-teal-800 underline">
              Settings → LLM profiles
            </Link>
            .
          </p>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(form.active)}
              onChange={(e) => update("active", e.target.checked)}
            />
            <FieldLabel helpId="agent.active">Active</FieldLabel>
          </label>
        </div>
        </div>
        ) : null}

        {editTab === "memory" && !isNew ? (
        <div className="flex flex-col gap-3" role="tabpanel">
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

        <SiteProfilesPanel agentId={agentId} />
        </div>
        ) : null}

        <div className="flex flex-wrap gap-2 border-t border-teal-100 pt-3">
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
            <>
              <ButtonWithHelp helpId="agents.copy">
                <button
                  type="button"
                  disabled={busy || copyBusy}
                  onClick={() => void onCopy()}
                  className="min-h-11 rounded-xl border border-violet-200 bg-violet-50 px-4 font-semibold text-violet-950 disabled:opacity-50"
                >
                  {copyBusy ? "Copying…" : "Copy agent"}
                </button>
              </ButtonWithHelp>
              <ButtonWithHelp helpId="agent.delete">
                <button
                  type="button"
                  disabled={busy || copyBusy}
                  onClick={onDelete}
                  className="min-h-11 rounded-xl border border-red-200 bg-red-50 px-4 font-semibold text-red-700 disabled:opacity-50"
                >
                  Delete
                </button>
              </ButtonWithHelp>
            </>
          ) : null}
        </div>
      </form>
    </div>
  );
}
