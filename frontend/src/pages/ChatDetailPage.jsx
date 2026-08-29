/**
 * @fileoverview Single chat view — send goals, poll messages/tasks, watch live cloud screen.
 * Purpose: Left thread scrolls on desktop; agent rail (screen + snapshot + goal) beside or below on mobile.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Newest messages shown on first paint; scroll-up loads the previous page. */
const MESSAGE_PAGE = 100;
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { resolveAgentMention } from "../lib/mentionAgent.js";
import { parseLearnCommand, parseSkillSlash, findSkillBySlash } from "../lib/skillSlash.js";
import { skillPickFromMessage, skillPickFromTask } from "../lib/skillPick.js";
import { formatChatMessageTime } from "../lib/formatDateTime.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { FieldLabel, ButtonWithHelp, PageGuideBanner, SectionTitle } from "../components/FieldLabel.jsx";
import { AgentTaskQueue } from "../components/AgentTaskQueue.jsx";
import { LiveScreen } from "../components/LiveScreen.jsx";
import { PageSnapshotPanel } from "../components/PageSnapshotPanel.jsx";
import { TrajectoryPanel } from "../components/TrajectoryPanel.jsx";
import { SkillPickNotice } from "../components/SkillPickNotice.jsx";
import { LlmTraceMessage } from "../components/LlmTraceMessage.jsx";

export function ChatDetailPage() {
  const { chatId } = useParams();
  const [chat, setChat] = useState(null);
  const [isCommon, setIsCommon] = useState(false);
  const [agents, setAgents] = useState([]);
  const [productionSkills, setProductionSkills] = useState([]);
  const [dispatchAgentId, setDispatchAgentId] = useState("");
  const [pinDefault, setPinDefault] = useState(false);
  const [autoRoute, setAutoRoute] = useState(true);
  const [pinBusy, setPinBusy] = useState(false);
  const [routeBusy, setRouteBusy] = useState(false);
  const [pendingRoute, setPendingRoute] = useState(null);
  const [watchAgentId, setWatchAgentId] = useState("");
  const [messages, setMessages] = useState([]);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [agentQueue, setAgentQueue] = useState({ pending: [], active: null });
  const [input, setInput] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [opsTriggerChats, setOpsTriggerChats] = useState([]);
  const threadRef = useRef(null);
  const bottomRef = useRef(null);
  /** Why: follow live agent text unless the user scrolls the thread up to read history. */
  const stickToBottomRef = useRef(true);
  const messagesRef = useRef([]);
  const loadingOlderRef = useRef(false);
  const hasOlderRef = useRef(false);

  /**
   * Merges message pages by id, oldest → newest.
   * @param {object[]} prev
   * @param {object[]} incoming
   * @returns {object[]}
   */
  function mergeMessages(prev, incoming) {
    const map = new Map();
    for (const m of prev || []) map.set(String(m._id), m);
    for (const m of incoming || []) map.set(String(m._id), m);
    return [...map.values()].sort((a, b) => {
      const idA = String(a._id);
      const idB = String(b._id);
      return idA < idB ? -1 : idA > idB ? 1 : 0;
    });
  }

  const load = useCallback(async () => {
    try {
      const existing = messagesRef.current;
      const newestId = existing.length ? existing[existing.length - 1]._id : "";
      const qs = newestId
        ? `?limit=${MESSAGE_PAGE}&after=${encodeURIComponent(newestId)}`
        : `?limit=${MESSAGE_PAGE}`;
      const data = await api(`/api/chats/${chatId}${qs}`);
      setChat(data.chat);
      setIsCommon(Boolean(data.isCommon));
      if (newestId) {
        setMessages((prev) => mergeMessages(prev, data.messages || []));
      } else {
        setMessages(data.messages || []);
        setHasOlderMessages(Boolean(data.messagesHasMore));
      }
      setTasks(data.tasks || []);
      setAgentQueue(data.agentQueue || { pending: [], active: null });
      const loadedChat = data.chat;
      if (data.isCommon && loadedChat) {
        const pinned = loadedChat.defaultAgent?._id || loadedChat.defaultAgent || "";
        const last = loadedChat.lastDispatchAgent?._id || loadedChat.lastDispatchAgent || "";
        setPinDefault(Boolean(pinned));
        setAutoRoute(loadedChat.autoRoute !== false);
        setDispatchAgentId((prev) => {
          if (prev) return prev;
          if (pinned) return String(pinned);
          if (last) return String(last);
          return prev;
        });
      }
    } catch (err) {
      setError(err);
    }
  }, [chatId]);

  /**
   * Prepends the previous 100 messages when the user scrolls to the top of the thread.
   */
  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !hasOlderRef.current) return;
    const oldest = messagesRef.current[0];
    if (!oldest?._id) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    stickToBottomRef.current = false;
    const el = threadRef.current;
    const prevHeight = el?.scrollHeight || 0;
    const prevTop = el?.scrollTop || 0;
    try {
      const data = await api(
        `/api/chats/${chatId}?limit=${MESSAGE_PAGE}&before=${encodeURIComponent(oldest._id)}`
      );
      const older = data.messages || [];
      setHasOlderMessages(Boolean(data.messagesHasMore));
      setMessages((prev) => mergeMessages(prev, older));
      requestAnimationFrame(() => {
        if (!el) return;
        el.scrollTop = prevTop + (el.scrollHeight - prevHeight);
      });
    } catch (err) {
      setError(err);
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [chatId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    hasOlderRef.current = hasOlderMessages;
  }, [hasOlderMessages]);

  useEffect(() => {
    messagesRef.current = [];
    setMessages([]);
    setHasOlderMessages(false);
    stickToBottomRef.current = true;
  }, [chatId]);

  useEffect(() => {
    api("/api/agents")
      .then((data) => {
        const list = data.agents || [];
        setAgents(list);
        const storageKey = `yambot-common-agent-${chatId}`;
        const saved = localStorage.getItem(storageKey);
        if (saved && list.some((a) => String(a._id) === saved)) {
          setDispatchAgentId((prev) => prev || saved);
        } else if (list[0]?._id) {
          setDispatchAgentId((prev) => prev || String(list[0]._id));
        }
      })
      .catch(() => {});
    api("/api/skills")
      .then((data) => {
        setProductionSkills((data.skills || []).filter((s) => s.status === "production"));
      })
      .catch(() => {});
  }, [chatId]);

  useEffect(() => {
    if (!dispatchAgentId || !isCommon) return;
    localStorage.setItem(`yambot-common-agent-${chatId}`, dispatchAgentId);
  }, [chatId, dispatchAgentId, isCommon]);

  useEffect(() => {
    load();
    // Why: while a task runs, poll faster so step announcements keep up with the live screen.
    const active = (tasks || []).some((t) =>
      ["running", "waiting_user", "queued"].includes(String(t.status || ""))
    );
    const id = setInterval(load, active ? 900 : 2500);
    return () => clearInterval(id);
  }, [load, tasks]);

  /**
   * Keeps the left thread pinned to the newest messages while the agent streams.
   */
  const scrollThreadToBottom = useCallback((smooth = false) => {
    const el = threadRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      if (smooth) {
        bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      } else {
        el.scrollTop = el.scrollHeight;
      }
    });
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    scrollThreadToBottom(false);
  }, [messages, scrollThreadToBottom]);

  function onThreadScroll() {
    const el = threadRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = gap < 96;
    if (el.scrollTop < 80) {
      void loadOlder();
    }
  }

  const waitingTask =
    agentQueue?.active?.status === "waiting_user" ? agentQueue.active : null;
  const activeRun = agentQueue?.active || null;
  const activeRuns = agentQueue?.actives || (activeRun ? [activeRun] : []);

  const mentionPreview = useMemo(() => {
    if (!isCommon || !input.trim().startsWith("@")) return null;
    return resolveAgentMention(input, agents);
  }, [agents, input, isCommon]);

  const textAfterMention = useMemo(() => {
    if (mentionPreview?.matched) return mentionPreview.strippedContent;
    return input.trim();
  }, [input, mentionPreview]);

  const learnPreview = useMemo(() => parseLearnCommand(input.trim()), [input]);

  const skillSlashPreview = useMemo(() => {
    if (learnPreview) return null;
    const slash = parseSkillSlash(textAfterMention);
    if (!slash) return null;
    const skill = findSkillBySlash(productionSkills, slash.slug);
    return { ...slash, skill };
  }, [learnPreview, productionSkills, textAfterMention]);

  useEffect(() => {
    if (!isCommon || !mentionPreview?.matched || !mentionPreview.agentId) return;
    setDispatchAgentId(mentionPreview.agentId);
  }, [isCommon, mentionPreview?.agentId, mentionPreview?.matched]);

  /** Bound agent for agent chats; watch picker for common chat when multiple workers run. */
  const liveAgentId = isCommon
    ? watchAgentId ||
      activeRun?.agent?._id ||
      activeRun?.agent ||
      dispatchAgentId ||
      null
    : chat?.agent?._id || chat?.agent || null;

  const watchedRun = useMemo(() => {
    if (!isCommon) return activeRun;
    if (!watchAgentId) return activeRun;
    return (
      activeRuns.find(
        (t) => String(t.agent?._id || t.agent) === String(watchAgentId)
      ) || activeRun
    );
  }, [activeRun, activeRuns, isCommon, watchAgentId]);

  const activeSkillPick = useMemo(
    () => skillPickFromTask(watchedRun || activeRun),
    [activeRun, watchedRun]
  );

  const isOpsTriggerChat = Boolean(chat?.title?.startsWith("Trigger ·"));

  useEffect(() => {
    if (isCommon || !liveAgentId || isOpsTriggerChat) {
      setOpsTriggerChats([]);
      return;
    }
    api("/api/chats?limit=0")
      .then((data) => {
        const ops = (data.chats || []).filter(
          (c) =>
            c.kind !== "common" &&
            c.agent &&
            String(c.agent?._id || c.agent) === String(liveAgentId) &&
            String(c._id) !== String(chatId) &&
            String(c.title || "").startsWith("Trigger ·")
        );
        setOpsTriggerChats(ops.slice(0, 8));
      })
      .catch(() => setOpsTriggerChats([]));
  }, [chatId, isCommon, isOpsTriggerChat, liveAgentId]);

  useEffect(() => {
    if (!isCommon || !activeRuns.length) return;
    const currentWatch = watchAgentId;
    const stillValid = activeRuns.some(
      (t) => String(t.agent?._id || t.agent) === String(currentWatch)
    );
    if (!currentWatch || !stillValid) {
      const next = activeRuns[0]?.agent?._id || activeRuns[0]?.agent;
      if (next) setWatchAgentId(String(next));
    }
  }, [activeRuns, isCommon, watchAgentId]);

  const liveAgentName = isCommon
    ? agents.find((a) => String(a._id) === String(liveAgentId))?.name ||
      watchedRun?.agent?.name ||
      null
    : chat?.agent?.name || null;

  /** Task doc with full events (active run from queue may omit events until merged). */
  const snapshotTask = useMemo(() => {
    const focus = watchedRun || activeRun;
    if (!focus?._id) return tasks[0] || null;
    return tasks.find((t) => String(t._id) === String(focus._id)) || focus;
  }, [activeRun, tasks, watchedRun]);

  const snapshotEvents = snapshotTask?.events || [];

  /**
   * @param {React.FormEvent} e
   */
  async function sendGoal(e) {
    e.preventDefault();
    const content = input.trim();
    if (!content) return;

    if (parseLearnCommand(content)) {
      setBusy(true);
      setError(null);
      stickToBottomRef.current = true;
      try {
        await api(`/api/chats/${chatId}/messages`, {
          method: "POST",
          body: JSON.stringify({ content }),
        });
        setInput("");
        await load();
        scrollThreadToBottom(true);
      } catch (err) {
        setError(err);
      } finally {
        setBusy(false);
      }
      return;
    }

    const mention = isCommon ? resolveAgentMention(content, agents) : null;
    const afterMention = mention?.matched ? mention.strippedContent.trim() : content;
    const slash = parseSkillSlash(afterMention);
    const goalAfterMention = slash ? slash.goal : afterMention;
    if (isCommon && !goalAfterMention && !slash) {
      setError({
        title: "Add a goal",
        detail: "Type instructions after the @mention.",
        hint: "Example: @CRM Bot open CRM and check Aanya",
      });
      return;
    }

    setBusy(true);
    setError(null);
    stickToBottomRef.current = true;
    try {
      await postGoalMessage(content);
    } catch (err) {
      if (err?.status === 409 && err?.needsConfirm && err?.suggestion) {
        setPendingRoute({ content, suggestion: err.suggestion });
        setError(null);
      } else {
        setError(err);
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * @param {React.FormEvent} e
   */
  async function sendAnswer(e) {
    e.preventDefault();
    if (!waitingTask || !answer.trim()) return;
    setBusy(true);
    stickToBottomRef.current = true;
    try {
      await api(`/api/chats/${chatId}/tasks/${waitingTask._id}/answer`, {
        method: "POST",
        body: JSON.stringify({ answer: answer.trim() }),
      });
      setAnswer("");
      await load();
      scrollThreadToBottom(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function toggleAutoRoute() {
    if (!isCommon) return;
    setRouteBusy(true);
    setError(null);
    try {
      const next = !autoRoute;
      await api(`/api/chats/${chatId}`, {
        method: "PATCH",
        body: JSON.stringify({ autoRoute: next }),
      });
      setAutoRoute(next);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setRouteBusy(false);
    }
  }

  /**
   * @param {string} content
   * @param {{ confirmRoute?: boolean, agentId?: string }} [opts]
   */
  async function postGoalMessage(content, opts = {}) {
    const mention = isCommon ? resolveAgentMention(content, agents) : null;
    const body = { content };
    if (opts.confirmRoute) {
      body.confirmRoute = true;
      body.agentId = opts.agentId;
    } else if (isCommon && !autoRoute && !mention?.matched) {
      if (!dispatchAgentId) {
        const err = new Error("Auto-route is off — choose an agent or use @mention.");
        err.title = "Pick an agent";
        err.detail = err.message;
        throw err;
      }
      body.agentId = dispatchAgentId;
    }
    await api(`/api/chats/${chatId}/messages`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    setInput("");
    setPendingRoute(null);
    await load();
    scrollThreadToBottom(true);
  }

  async function confirmPendingRoute() {
    if (!pendingRoute) return;
    setBusy(true);
    setError(null);
    try {
      await postGoalMessage(pendingRoute.content, {
        confirmRoute: true,
        agentId: pendingRoute.suggestion.agentId,
      });
      setDispatchAgentId(String(pendingRoute.suggestion.agentId));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function togglePinDefault() {
    if (!isCommon || !dispatchAgentId) return;
    setPinBusy(true);
    setError(null);
    try {
      const nextPinned = !pinDefault;
      await api(`/api/chats/${chatId}`, {
        method: "PATCH",
        body: JSON.stringify({
          defaultAgentId: nextPinned ? dispatchAgentId : null,
        }),
      });
      setPinDefault(nextPinned);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setPinBusy(false);
    }
  }

  /**
   * @param {object} message
   * @returns {string|null}
   */
  function messageAgentLabel(message) {
    if (!isCommon && !message.meta?.invokedSkillName) return null;
    const parts = [];
    if (isCommon && message.role === "user" && message.meta?.dispatchAgentName) {
      parts.push(message.meta.dispatchAgentName);
    }
    if (message.meta?.invokedSkillName) {
      parts.push(`/${message.meta.skillSlug || message.meta.invokedSkillName}`);
    }
    if (message.role === "system" && message.meta?.agentName && !parts.length) {
      parts.push(message.meta.agentName);
    }
    return parts.length ? parts.join(" · ") : null;
  }

  async function stopAgent() {
    if (!activeRun) return;
    if (!window.confirm("Stop the agent's current run? Queued goals will stay in the queue.")) return;
    setStopping(true);
    setError(null);
    try {
      await api(`/api/chats/${chatId}/stop`, { method: "POST", body: "{}" });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setStopping(false);
    }
  }

  /** Fixed-aspect live screen box — screenshot scales inside, no inner scrollbar. */
  const agentScreenBlock = (
    <div className="flex shrink-0 flex-col overflow-hidden">
      <div className="mb-1 flex shrink-0 items-center justify-between gap-2">
        <SectionTitle helpId="chat.liveScreen">Agent screen</SectionTitle>
        {activeRun ? (
          <ButtonWithHelp helpId="chat.stop">
            <button
              type="button"
              onClick={stopAgent}
              disabled={stopping}
              className="inline-flex min-h-9 items-center rounded-xl bg-red-600 px-3 text-xs font-bold text-white disabled:opacity-50 lg:min-h-11 lg:px-4 lg:text-sm"
            >
              {stopping ? "Stopping…" : "Stop"}
            </button>
          </ButtonWithHelp>
        ) : null}
      </div>
      <div className="aspect-[16/10] w-full max-h-[min(40dvh,14rem)] min-h-[10.5rem] overflow-hidden sm:max-h-[min(42dvh,16rem)] lg:max-h-[min(36vh,20rem)] lg:min-h-[12rem]">
        {liveAgentId ? (
          <LiveScreen
            agentId={String(liveAgentId)}
            agentName={liveAgentName || ""}
            taskId={watchedRun?._id ? String(watchedRun._id) : activeRun?._id ? String(activeRun._id) : undefined}
            demoTitle={(snapshotTask?.goal || chat?.title || "Chat demonstration").slice(0, 120)}
            chatId={chatId}
            fill
            compact
            className="h-full w-full"
          />
        ) : (
          <p className="flex h-full items-center rounded-2xl border border-dashed border-teal-200 bg-white p-3 text-sm text-teal-900/70">
            {isCommon
              ? "Pick an agent and send a goal — the live screen follows whichever agent is running."
              : "No agent bound — no cloud screen."}
          </p>
        )}
      </div>
    </div>
  );

  /** Goal / instructions — own card section (not bundled with snapshot + trajectory scroll). */
  const goalSection = (
    <section className="flex shrink-0 flex-col gap-2 rounded-2xl border border-teal-100 bg-white p-3 shadow-sm">
      {waitingTask ? (
        <form
          onSubmit={sendAnswer}
          className="flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-2 sm:p-3"
        >
          <FieldLabel helpId="chat.answer" className="text-xs text-amber-950 sm:text-sm">
            Agent is waiting for your answer
          </FieldLabel>
          <input
            className="min-h-10 w-full rounded-xl border border-amber-200 bg-white px-3 text-sm"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Type your reply…"
          />
          <button
            type="submit"
            disabled={busy}
            className="min-h-10 w-full rounded-xl bg-amber-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            Send answer
          </button>
        </form>
      ) : null}

      {isCommon && activeRuns.length > 1 ? (
        <label className="mb-1 flex shrink-0 flex-col gap-1 text-xs">
          <span className="font-semibold text-violet-900">Watch agent</span>
          <select
            className="min-h-9 rounded-xl border border-violet-100 bg-white px-2"
            value={watchAgentId || String(activeRuns[0]?.agent?._id || activeRuns[0]?.agent || "")}
            onChange={(e) => setWatchAgentId(e.target.value)}
          >
            {activeRuns.map((t) => (
              <option key={t._id} value={String(t.agent?._id || t.agent)}>
                {t.agent?.name || "Agent"} · {t.status}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <form onSubmit={sendGoal} className="flex flex-col gap-2">
        {isCommon ? (
          <>
            <label className="flex items-center gap-2 text-sm text-violet-950">
              <input
                type="checkbox"
                checked={autoRoute}
                disabled={routeBusy}
                onChange={toggleAutoRoute}
                className="h-4 w-4 rounded border-violet-200"
              />
              <FieldLabel helpId="chat.autoRoute" className="text-sm">
                Auto-route to best agent
              </FieldLabel>
            </label>
            <label className="flex w-full flex-col gap-1 text-sm">
              <FieldLabel helpId="chat.agentPicker">
                {autoRoute ? "Override agent (optional)" : "Dispatch to agent"}
              </FieldLabel>
              <select
                className="min-h-11 w-full rounded-xl border border-violet-100 bg-white px-3"
                value={dispatchAgentId}
                onChange={(e) => setDispatchAgentId(e.target.value)}
                disabled={busy}
              >
                {agents.length === 0 ? (
                  <option value="">No agents — create one first</option>
                ) : (
                  agents.map((a) => (
                    <option key={a._id} value={a._id}>
                      {a.name} ({a.skill})
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-violet-950">
              <input
                type="checkbox"
                checked={pinDefault}
                disabled={pinBusy || !dispatchAgentId}
                onChange={togglePinDefault}
                className="h-4 w-4 rounded border-violet-200"
              />
              <FieldLabel helpId="chat.pinDefault" className="text-sm">
                Pin as default agent for this chat
              </FieldLabel>
            </label>
            {mentionPreview?.matched ? (
              <p className="rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-xs text-violet-950">
                @mention → <strong>{mentionPreview.agentName}</strong>
                {mentionPreview.strippedContent
                  ? ` · goal: “${mentionPreview.strippedContent.slice(0, 80)}”`
                  : ""}
              </p>
            ) : null}
            {learnPreview ? (
              <p className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                /learn → draft skill from latest completed task
                {learnPreview.name ? ` named “${learnPreview.name}”` : ""}
              </p>
            ) : null}
            {skillSlashPreview?.skill ? (
              <p className="rounded-xl border border-teal-100 bg-teal-50 px-3 py-2 text-xs text-teal-950">
                /{skillSlashPreview.slug} → <strong>{skillSlashPreview.skill.name}</strong>
                {skillSlashPreview.goal ? ` · ${skillSlashPreview.goal.slice(0, 80)}` : ""}
                <span className="mt-1 block text-teal-900/75">
                  Will load via slash invoke when you send.
                </span>
              </p>
            ) : null}
            {productionSkills.length ? (
              <p className="text-xs text-teal-900/60">
                Skills: {productionSkills.slice(0, 4).map((s) => `/${s.slug || s.name}`).join(", ")}
                {productionSkills.length > 4 ? "…" : ""}
              </p>
            ) : null}
          </>
        ) : null}
        {pendingRoute ? (
          <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <p>
              Route to <strong>{pendingRoute.suggestion.agentName}</strong>? (
              {Math.round((pendingRoute.suggestion.confidence || 0) * 100)}% confidence)
            </p>
            <p className="text-xs text-amber-900/80">{pendingRoute.suggestion.reason}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={confirmPendingRoute}
                disabled={busy}
                className="min-h-10 rounded-xl bg-amber-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingRoute(null);
                  setDispatchAgentId(String(pendingRoute.suggestion.agentId));
                }}
                className="min-h-10 rounded-xl border border-amber-300 bg-white px-4 text-sm font-semibold text-amber-950"
              >
                Pick different agent
              </button>
            </div>
          </div>
        ) : null}
        <FieldLabel helpId="chat.goalInput" className="text-sm">
          Goal / instructions
        </FieldLabel>
        <textarea
          className="min-h-16 w-full resize-none rounded-2xl border border-teal-100 bg-white px-3 py-2 text-base shadow-sm sm:min-h-[4.5rem]"
          placeholder={
            isCommon
              ? autoRoute
                ? "Type your goal — auto-routes to the best agent"
                : "@Agent /skill-slug goal… or /learn"
              : "/skill-slug goal… or /learn"
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={3}
        />
        <ButtonWithHelp helpId="chat.send" className="flex w-full items-center gap-1.5">
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 w-full rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Sending…" : activeRun ? "Queue goal" : "Send goal"}
          </button>
        </ButtonWithHelp>
      </form>
    </section>
  );

  const controlPanel = (
    <div className="flex flex-col gap-2 lg:gap-3">
      <AgentTaskQueue
        chatId={chatId}
        agentQueue={agentQueue}
        isCommon={isCommon}
        onChanged={load}
        onError={setError}
      />
      {agentScreenBlock}
      <PageSnapshotPanel events={snapshotEvents} compact />
      <TrajectoryPanel task={snapshotTask} />
      {goalSection}
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-3 py-3 sm:gap-4 sm:px-4 md:px-6 lg:flex lg:h-full lg:min-h-0 lg:min-h-full lg:flex-1 lg:overflow-hidden">
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2">
        <Link
          to="/"
          className="inline-flex min-h-11 shrink-0 items-center rounded-xl border border-teal-100 bg-white px-3 text-sm font-semibold"
        >
          ← Chats
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold tracking-tight sm:text-xl">
          {chat?.title || "Chat"}
        </h1>
        {isCommon ? (
          <span className="max-w-full truncate rounded-full border border-violet-100 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-900">
            Common chat
            {liveAgentName ? ` · live: ${liveAgentName}` : ""}
          </span>
        ) : chat?.agent?.name ? (
          <span className="max-w-full truncate rounded-full border border-teal-100 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-900">
            {chat.agent.name}
            {chat.agent.skill ? ` · ${chat.agent.skill}` : ""}
          </span>
        ) : null}
      </div>

      <PageGuideBanner helpId="chats.page" />

      {isOpsTriggerChat ? (
        <p className="shrink-0 rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-sm text-violet-950">
          <strong>Operations trigger thread</strong> — goals, agent replies, and outcome routing messages
          for this trigger appear in this chat (not your main agent chat).
        </p>
      ) : opsTriggerChats.length ? (
        <div className="shrink-0 rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-sm text-violet-950">
          <p className="font-semibold">Operations trigger threads for this agent</p>
          <p className="mt-1 text-xs text-violet-900/80">
            Automation from Operations runs in separate chats. Open one to see task results and outcome
            routing:
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {opsTriggerChats.map((c) => (
              <li key={c._id}>
                <Link
                  to={`/chats/${c._id}`}
                  className="font-semibold text-violet-900 underline"
                >
                  {c.title}
                </Link>
                <span className="ml-2 text-xs text-violet-900/60">
                  {c.updatedAt ? new Date(c.updatedAt).toLocaleString() : ""}
                </span>
              </li>
            ))}
          </ul>
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

      {activeRun || tasks[0] ? (
        <div className="flex shrink-0 flex-col gap-2 rounded-xl border border-teal-100 bg-white px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 break-words">
            <span>
              {activeRun ? (
                <>
                  {isCommon && activeRun.agent?.name ? (
                    <>
                      <strong>{activeRun.agent.name}</strong> is{" "}
                    </>
                  ) : null}
                  Agent is <strong>{activeRun.status}</strong>
                  {activeRun.resultSummary
                    ? ` — ${activeRun.resultSummary.slice(0, 120)}`
                    : ` — ${activeRun.goal.slice(0, 80)}`}
                </>
              ) : (
                <>
                  Latest task: <strong>{tasks[0].status}</strong>
                  {tasks[0].resultSummary ? ` — ${tasks[0].resultSummary.slice(0, 120)}` : ""}
                </>
              )}
            </span>
            {activeRun ? (
              <ButtonWithHelp helpId="chat.stop" className="shrink-0 lg:hidden">
                <button
                  type="button"
                  onClick={stopAgent}
                  disabled={stopping}
                  className="inline-flex min-h-11 shrink-0 items-center rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 disabled:opacity-50"
                >
                  {stopping ? "Stopping…" : "Stop"}
                </button>
              </ButtonWithHelp>
            ) : null}
          </div>
          {activeSkillPick ? (
            <SkillPickNotice pick={activeSkillPick} className="text-xs" />
          ) : null}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] lg:items-stretch lg:gap-5">
        <div
          ref={threadRef}
          onScroll={onThreadScroll}
          className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto rounded-2xl border border-teal-100 bg-white p-3 shadow-sm sm:p-4"
        >
          {loadingOlder ? (
            <p className="text-center text-xs text-teal-900/60">Loading earlier messages…</p>
          ) : hasOlderMessages ? (
            <p className="text-center text-xs text-teal-900/50">Scroll up for earlier messages</p>
          ) : messages.length > 0 ? (
            <p className="text-center text-xs text-teal-900/40">Beginning of this chat</p>
          ) : null}
          {messages.length === 0 && !loadingOlder ? (
            <p className="text-sm text-teal-900/60">No messages yet. Send a goal on the right.</p>
          ) : null}
          {messages.map((m) => {
            const agentLabel = messageAgentLabel(m);
            const skillPick =
              m.meta?.kind === "skill_selected" && m.meta?.skillPick
                ? m.meta.skillPick
                : skillPickFromMessage(m);
            const isSkillPickNotice = m.meta?.kind === "skill_selected" && skillPick;
            const llmTraceType =
              m.meta?.type === "llm_request" || m.meta?.type === "llm_response"
                ? m.meta.type
                : null;
            return (
            <article
              key={m._id}
              className={`max-w-[95%] break-words rounded-xl px-3 py-2 text-sm sm:max-w-[85%] ${
                m.role === "user"
                  ? "self-end bg-teal-700 text-white"
                  : m.role === "assistant"
                    ? "self-start bg-teal-50 text-teal-950"
                    : isSkillPickNotice
                      ? "self-start border border-violet-100 bg-violet-50/50 text-violet-950"
                      : llmTraceType
                        ? "self-start max-w-[98%] bg-transparent p-0 shadow-none sm:max-w-[92%]"
                        : "self-start bg-slate-50 text-slate-700"
              }`}
            >
              {!llmTraceType ? (
                <div className="mb-1 flex items-baseline justify-between gap-2 text-[0.7rem] opacity-70">
                  <span className="uppercase">
                    {isSkillPickNotice ? "skill" : m.role}
                    {agentLabel ? (
                      <span className="ml-1.5 normal-case font-semibold">· {agentLabel}</span>
                    ) : null}
                  </span>
                  {m.createdAt ? (
                    <time
                      dateTime={new Date(m.createdAt).toISOString()}
                      className="shrink-0 normal-case tabular-nums"
                    >
                      {formatChatMessageTime(m.createdAt)}
                    </time>
                  ) : null}
                </div>
              ) : null}
              {llmTraceType ? (
                <LlmTraceMessage
                  type={llmTraceType}
                  content={m.content}
                  meta={m.meta}
                  createdAt={m.createdAt}
                />
              ) : isSkillPickNotice ? (
                <SkillPickNotice pick={skillPick} />
              ) : (
                <>
                  {m.role === "user" && skillPick ? (
                    <div className="mb-2 [&_.rounded-xl]:border-teal-500/30 [&_.rounded-xl]:bg-teal-600/40 [&_.rounded-xl]:text-white">
                      <SkillPickNotice pick={skillPick} />
                    </div>
                  ) : null}
                  <div className="whitespace-pre-wrap break-words">{m.content}</div>
                </>
              )}
            </article>
            );
          })}
          <div ref={bottomRef} className="h-px w-full shrink-0" />
        </div>

        <aside className="flex min-h-0 w-full min-w-0 flex-col gap-2 sm:gap-3 lg:max-h-full lg:overflow-y-auto lg:overscroll-contain">
          {controlPanel}
        </aside>
      </div>
    </div>
  );
}
