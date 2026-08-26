/**
 * @fileoverview Single chat view — send goals, poll messages/tasks, watch live cloud screen.
 * Purpose: Left thread scrolls; right rail keeps screen + snapshot + goal visible in one column.
 * On mobile, the same three blocks stay fixed at the bottom in a viewport grid.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { resolveAgentMention } from "../lib/mentionAgent.js";
import { parseLearnCommand, parseSkillSlash, findSkillBySlash } from "../lib/skillSlash.js";
import { formatChatMessageTime } from "../lib/formatDateTime.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { FieldLabel, ButtonWithHelp, PageGuideBanner, SectionTitle } from "../components/FieldLabel.jsx";
import { AgentTaskQueue } from "../components/AgentTaskQueue.jsx";
import { LiveScreen } from "../components/LiveScreen.jsx";
import { PageSnapshotPanel } from "../components/PageSnapshotPanel.jsx";
import { TrajectoryPanel } from "../components/TrajectoryPanel.jsx";

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
  const [tasks, setTasks] = useState([]);
  const [agentQueue, setAgentQueue] = useState({ pending: [], active: null });
  const [input, setInput] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const threadRef = useRef(null);
  const bottomRef = useRef(null);
  /** Why: follow live agent text unless the user scrolls the thread up to read history. */
  const stickToBottomRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await api(`/api/chats/${chatId}`);
      setChat(data.chat);
      setIsCommon(Boolean(data.isCommon));
      setMessages(data.messages || []);
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
    const id = setInterval(load, 2500);
    return () => clearInterval(id);
  }, [load]);

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

  /** Screen + snapshot + goal — always visible together (grid rows, no outer scroll). */
  const stickyAgentStack = (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(7.5rem,1fr)_minmax(5rem,0.35fr)_auto_auto] gap-2">
      <div className="flex min-h-0 flex-col overflow-hidden">
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
        {liveAgentId ? (
          <LiveScreen
            agentId={String(liveAgentId)}
            taskId={watchedRun?._id ? String(watchedRun._id) : activeRun?._id ? String(activeRun._id) : undefined}
            demoTitle={(snapshotTask?.goal || chat?.title || "Chat demonstration").slice(0, 120)}
            fill
            compact
            className="min-h-0 flex-1"
          />
        ) : (
          <p className="flex min-h-0 flex-1 items-center rounded-2xl border border-dashed border-teal-200 bg-white p-3 text-sm text-teal-900/70">
            {isCommon
              ? "Pick an agent and send a goal — the live screen follows whichever agent is running."
              : "No agent bound — no cloud screen."}
          </p>
        )}
      </div>

      <PageSnapshotPanel events={snapshotEvents} compact className="min-h-0" />

      <TrajectoryPanel task={snapshotTask} className="shrink-0" />

      <div className="flex shrink-0 flex-col gap-2">
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
      </div>
    </div>
  );

  const controlPanel = (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden lg:gap-3">
      <AgentTaskQueue
        chatId={chatId}
        agentQueue={agentQueue}
        isCommon={isCommon}
        onChanged={load}
        onError={setError}
      />
      {stickyAgentStack}
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-3 pt-3 pb-0 sm:gap-4 sm:px-4 sm:pt-4 md:px-6 lg:h-[calc(100dvh-0.5rem)] lg:max-h-[calc(100dvh-0.5rem)] lg:overflow-hidden lg:pb-4">
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

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}

      {activeRun || tasks[0] ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 break-words rounded-xl border border-teal-100 bg-white px-3 py-2 text-sm">
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
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] lg:items-stretch lg:gap-5">
        <div
          ref={threadRef}
          onScroll={onThreadScroll}
          className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto rounded-2xl border border-teal-100 bg-white p-3 shadow-sm sm:p-4"
        >
          {messages.length === 0 ? (
            <p className="text-sm text-teal-900/60">No messages yet. Send a goal on the right.</p>
          ) : null}
          {messages.map((m) => {
            const agentLabel = messageAgentLabel(m);
            return (
            <article
              key={m._id}
              className={`max-w-[95%] break-words rounded-xl px-3 py-2 text-sm sm:max-w-[85%] ${
                m.role === "user"
                  ? "self-end bg-teal-700 text-white"
                  : m.role === "assistant"
                    ? "self-start bg-teal-50 text-teal-950"
                    : "self-start bg-slate-50 text-slate-700"
              }`}
            >
              <div className="mb-1 flex items-baseline justify-between gap-2 text-[0.7rem] opacity-70">
                <span className="uppercase">
                  {m.role}
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
              <div className="whitespace-pre-wrap break-words">{m.content}</div>
            </article>
            );
          })}
          <div ref={bottomRef} className="h-px w-full shrink-0" />
        </div>

        <aside className="hidden min-h-0 overflow-hidden lg:sticky lg:top-3 lg:flex lg:max-h-[calc(100dvh-5.5rem)] lg:flex-col lg:self-start lg:rounded-2xl lg:border lg:border-teal-100 lg:bg-[color-mix(in_srgb,var(--yb-bg)_88%,white)] lg:p-3 lg:shadow-sm lg:backdrop-blur-md">
          {controlPanel}
        </aside>
      </div>

      {/* Why: reserve scroll room so the fixed mobile dock does not cover the last messages. */}
      <div className="h-[min(68dvh,30rem)] shrink-0 lg:hidden" aria-hidden />

      <div
        className="fixed inset-x-0 bottom-0 z-30 grid max-h-[min(68dvh,calc(100dvh-env(safe-area-inset-bottom,0px)-3rem))] grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-t border-teal-100 bg-[var(--yb-bg)] shadow-[0_-8px_24px_rgba(16,35,31,0.08)] lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="min-h-0 overflow-hidden px-3 pt-2 pb-2">{controlPanel}</div>
      </div>
    </div>
  );
}
