/**
 * @fileoverview Compact run-status bubble for operational chat messages.
 * Purpose: Collapse noisy O/LLM/step chips into one bubble; click opens a modal of all events.
 * Downstream: ChatDetailPage, FloatingChatWidget.
 */

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { formatChatMessageTime } from "../lib/formatDateTime.js";

/**
 * Kinds / event types that should render as icons, not full bubbles.
 * @type {Set<string>}
 */
export const OPS_ICON_KINDS = new Set([
  "queued",
  "skill_selected",
  "llm_request",
  "llm_response",
  "step",
  "api_start",
  "intent_question",
  "computer_started",
  "plan",
  "observe",
  "page",
  "thinking",
  "opening",
  "captcha",
  "human_handoff",
  "human_handoff_done",
  "late_peer_resume",
  "operator_inject_ack",
  "agent_message_in",
  "agent_message_out",
  "agent_message_timeout",
  "peer_result",
  "peer_delegated",
  "soft_wait",
  "info",
  "event",
  "curated_pull",
  "curated_save",
  "site_memory_pull",
  "skill_learned",
]);

/**
 * @param {object} message
 * @returns {boolean}
 */
export function isOpsIconMessage(message) {
  if (!message) return false;
  if (message.meta?.ui === "icon") return true;
  const kind = String(message.meta?.kind || message.meta?.type || "").trim();
  if (kind && OPS_ICON_KINDS.has(kind)) return true;
  const content = String(message.content || "");
  // Why: A2A / peer / system status lines should stay as chips even when meta.kind is missing.
  if (message.role === "system") {
    if (
      /^(→|←)\s/.test(content) ||
      /^(PEER RESULT|PEER FAILED|SOFT WAIT|Late result from|Sent to the running agent)/i.test(
        content
      ) ||
      /^Goal queued|^Queued for/i.test(content)
    ) {
      return true;
    }
  }
  return (
    /^(Goal queued|Queued for|Cloud computer|Plan:|Looking at:|Thinking…|Opening |Step \d|No skill matched|Skill:|→ Sent to LLM|← Received from LLM|← LLM error|Cloud agent asks:|Cloud agent:|API agent |PEER RESULT|PEER FAILED|SOFT WAIT)/i.test(
      content
    ) || /^(→|←)\s/.test(content)
  );
}

/**
 * @param {object} message
 * @returns {{ icon: string, label: string }}
 */
export function opsIconMeta(message) {
  const kind = String(message.meta?.kind || message.meta?.type || "").trim();
  const content = String(message.content || "");
  if (kind === "queued" || /^Goal queued|^Queued for/i.test(content)) {
    return { icon: "Q", label: "Queued" };
  }
  if (kind === "skill_selected" || /^No skill matched|^Skill:/i.test(content)) {
    return { icon: "S", label: "Skill" };
  }
  if (kind === "llm_request" || /^→ Sent to LLM/i.test(content)) {
    return { icon: "↑", label: "LLM" };
  }
  if (kind === "llm_response" || /^← Received from LLM|^← LLM error/i.test(content)) {
    return { icon: "↓", label: "LLM reply" };
  }
  if (kind === "step" || /^Step \d/i.test(content)) {
    return { icon: "▸", label: "Step" };
  }
  if (
    kind === "computer_started" ||
    kind === "api_start" ||
    /^Cloud computer|^API agent /i.test(content)
  ) {
    return { icon: "C", label: "Started" };
  }
  if (kind === "plan" || /^Plan:/i.test(content)) {
    return { icon: "P", label: "Plan" };
  }
  if (kind === "observe" || kind === "page" || /^Looking at:/i.test(content)) {
    return { icon: "O", label: "Page" };
  }
  if (kind === "intent_question") {
    return { icon: "A", label: "Answer mode" };
  }
  if (kind === "late_peer_resume" || /^Late result from/i.test(content)) {
    return { icon: "↻", label: "Late peer" };
  }
  if (kind === "operator_inject_ack" || /^Sent to the running agent/i.test(content)) {
    return { icon: "→", label: "Injected" };
  }
  if (
    kind === "agent_message_out" ||
    (/^→\s/.test(content) && !/^→ Sent to LLM/i.test(content))
  ) {
    return { icon: "↦", label: "To peer" };
  }
  if (kind === "agent_message_in" || /^←\s/.test(content)) {
    return { icon: "↤", label: "From peer" };
  }
  if (kind === "peer_result" || /^(PEER RESULT|PEER FAILED)\b/i.test(content)) {
    return { icon: "⇄", label: "Peer result" };
  }
  if (kind === "soft_wait" || /^SOFT WAIT\b/i.test(content)) {
    return { icon: "⏳", label: "Soft wait" };
  }
  if (kind === "curated_pull" || /^Memory pull/i.test(content)) {
    return { icon: "M", label: "Memory" };
  }
  if (kind === "curated_save" || /^Memory saved/i.test(content)) {
    return { icon: "M+", label: "Saved" };
  }
  if (kind === "site_memory_pull" || /^Site memory/i.test(content)) {
    return { icon: "🌐", label: "Site" };
  }
  if (kind === "skill_learned" || /^Skill (learned|updated)/i.test(content)) {
    return { icon: "S+", label: "Skill+" };
  }
  if (kind === "human_handoff" || /^Cloud agent:/i.test(content)) {
    return { icon: "🙋", label: "Handoff" };
  }
  if (kind === "info") {
    return { icon: "i", label: "Info" };
  }
  if (/^Thinking/i.test(content)) return { icon: "…", label: "Thinking" };
  if (/^Opening /i.test(content)) return { icon: "↗", label: "Navigate" };
  return { icon: "•", label: "Status" };
}

/**
 * @param {object[]} messages
 * @returns {string}
 */
function summarizeOpsKinds(messages) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const m of messages || []) {
    const { label } = opsIconMeta(m);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, n]) => (n > 1 ? `${label}×${n}` : label))
    .join(" · ");
}

/**
 * Full-content panel for one ops message (used inside the run modal).
 * @param {{
 *   message: object,
 *   label: string,
 *   icon: string,
 * }} props
 */
function OpsEventDetail({ message, label, icon }) {
  const curated = message?.meta?.kind === "curated_pull" ? message.meta?.curatedMemory : null;
  const saved = message?.meta?.kind === "curated_save" ? message.meta?.curatedSave : null;
  const siteMem = message?.meta?.kind === "site_memory_pull" ? message.meta?.siteMemory : null;
  const skillLearned =
    message?.meta?.kind === "skill_learned" ? message.meta?.skillLearned : null;
  const body = String(message?.content || "").trim() || label;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-teal-800/70">
        <span
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-teal-100 bg-teal-50 text-[0.625rem] text-teal-900"
          aria-hidden="true"
        >
          {icon}
        </span>
        <span className="font-semibold text-teal-950">{label}</span>
        {message?.createdAt ? (
          <time dateTime={new Date(message.createdAt).toISOString()}>
            {formatChatMessageTime(message.createdAt)}
          </time>
        ) : null}
      </div>
      {curated ? (
        <CuratedPullDetails curated={curated} fallbackContent={body} />
      ) : saved ? (
        <div className="flex flex-col gap-3 text-sm text-teal-950">
          <p className="text-xs text-teal-800/70">
            Durable facts written to this agent’s MEMORY after the run (
            {saved.count || (saved.facts || []).length}).
          </p>
          <PulledList
            title="Saved to agent MEMORY"
            rows={(saved.facts || []).map((content, i) => ({
              rank: i + 1,
              content,
            }))}
            empty="No facts saved."
          />
        </div>
      ) : siteMem ? (
        <SiteMemoryPullDetails site={siteMem} fallbackContent={body} />
      ) : skillLearned ? (
        <SkillLearnedDetails learned={skillLearned} fallbackContent={body} />
      ) : (
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-teal-950">
          {body}
        </pre>
      )}
    </div>
  );
}

/**
 * Modal listing every ops event for a run segment.
 * @param {{
 *   messages: object[],
 *   onClose: () => void,
 * }} props
 */
function RunOpsModal({ messages, onClose }) {
  const titleId = useId();
  const list = Array.isArray(messages) ? messages : [];
  const [selectedId, setSelectedId] = useState(/** @type {string|null} */ (null));

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return list.find((m) => String(m._id) === selectedId) || null;
  }, [list, selectedId]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") {
        if (selectedId) setSelectedId(null);
        else onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, selectedId]);

  const selectedMeta = selected ? opsIconMeta(selected) : null;

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-teal-950/45 p-0 sm:items-center sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[min(90dvh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-teal-100 bg-white shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-teal-100 px-4 py-3">
          {selectedId ? (
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-teal-100 text-sm font-bold text-teal-900"
              aria-label="Back to event list"
            >
              ←
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-sm font-bold text-teal-950">
              {selectedMeta ? selectedMeta.label : `Run details · ${list.length} events`}
            </h2>
            <p className="truncate text-xs text-teal-900/60">
              {selectedMeta
                ? String(selected?.content || "").replace(/\s+/g, " ").slice(0, 80)
                : summarizeOpsKinds(list)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-teal-100 text-lg font-bold text-teal-900"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4">
          {selected && selectedMeta ? (
            <OpsEventDetail
              message={selected}
              label={selectedMeta.label}
              icon={selectedMeta.icon}
            />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {list.map((m, i) => {
                const { icon, label } = opsIconMeta(m);
                const tip = String(m.content || label).replace(/\s+/g, " ").slice(0, 140);
                const id = String(m._id || `ops-${i}`);
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(id)}
                      className="flex w-full min-h-11 items-start gap-2 rounded-xl border border-teal-50 bg-teal-50/40 px-2.5 py-2 text-left transition hover:bg-teal-100/70 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
                    >
                      <span
                        className="yb-ops-chip mt-0.5 inline-flex shrink-0 items-center justify-center rounded-full border border-teal-100 bg-white text-teal-900"
                        aria-hidden="true"
                      >
                        <span>{icon}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="text-xs font-semibold text-teal-950">{label}</span>
                          {m.createdAt ? (
                            <time
                              dateTime={new Date(m.createdAt).toISOString()}
                              className="shrink-0 text-[0.65rem] tabular-nums text-teal-800/55"
                            >
                              {formatChatMessageTime(m.createdAt)}
                            </time>
                          ) : null}
                        </span>
                        <span className="mt-0.5 line-clamp-2 text-[0.7rem] leading-snug text-teal-900/75">
                          {tip}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Ranked memory facts pulled into this run's prompt.
 * @param {{ curated: object, fallbackContent?: string }} props
 */
function CuratedPullDetails({ curated, fallbackContent = "" }) {
  const agent = curated?.agent || {};
  const user = curated?.user || {};
  let agentRows = Array.isArray(agent.pulled) ? agent.pulled : [];
  let userRows = Array.isArray(user.pulled) ? user.pulled : [];

  if (!agentRows.length && !userRows.length && fallbackContent) {
    const parsed = parsePulledFromContent(fallbackContent);
    agentRows = parsed.agent;
    userRows = parsed.user;
  }

  const agentTotal = Number(agent.total) || agentRows.length;
  const userTotal = Number(user.total) || userRows.length;
  const injected = agentRows.length + userRows.length;

  return (
    <div className="flex flex-col gap-4 text-sm text-teal-950">
      <p className="text-xs text-teal-800/70">
        {injected > 0 ? (
          <>
            <span className="font-semibold text-teal-950">
              {injected} fact{injected === 1 ? "" : "s"} injected
            </span>
            {" · "}
          </>
        ) : (
          <span className="font-semibold text-amber-900">Nothing matched this goal · </span>
        )}
        agent {agent.mode || "—"} {agentRows.length}/{agentTotal}
        {userTotal || userRows.length ? (
          <>
            {" "}
            · user {user.mode || "—"} {userRows.length}/{userTotal || userRows.length}
          </>
        ) : null}
      </p>
      <PulledList
        title="Agent MEMORY"
        rows={agentRows}
        empty={
          agentTotal === 0
            ? "This agent has no curated MEMORY yet — facts appear here after remember / post-run save."
            : "None of this agent’s MEMORY matched this goal."
        }
      />
      <PulledList
        title="USER prefs"
        rows={userRows}
        empty={
          userTotal === 0 && userRows.length === 0
            ? "No account USER prefs on file (Settings → Memory: Mongo + Mem0)."
            : userRows.length === 0
              ? "No USER prefs matched this goal."
              : "No USER prefs matched this goal."
        }
      />
      {Number(curated?.mem0?.userMerged || 0) > 0 ? (
        <p className="text-[0.7rem] text-amber-900/80">
          Includes {curated.mem0.userMerged} Mem0 USER fact
          {curated.mem0.userMerged === 1 ? "" : "s"} — manage under Settings → Memory → Mem0
          USER prefs. Agent Mem0: Agents → View memory → View Mem0.
        </p>
      ) : null}    </div>
  );
}

/**
 * @param {{ site: object, fallbackContent?: string }} props
 */
function SiteMemoryPullDetails({ site, fallbackContent = "" }) {
  const domain = String(site?.domain || "").trim() || "site";
  const hints = Array.isArray(site?.hints) ? site.hints : [];
  const stats = site?.stats || {};
  const insertedBlock = String(site?.insertedBlock || "").trim() || fallbackContent;
  const insertionPoint = String(site?.insertionPoint || "").trim();

  return (
    <div className="flex flex-col gap-4 text-sm text-teal-950">
      <p className="text-xs text-teal-800/70">
        <span className="font-semibold text-teal-950">{domain}</span>
        {" · "}
        {hints.length} hint{hints.length === 1 ? "" : "s"}
        {" · "}
        {stats.successes || 0} ok · {stats.failures || 0} fail · {stats.visits || 0} visits
      </p>
      <div>
        <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-teal-800/70">
          How inserted
        </h3>
        <p className="text-xs leading-relaxed text-teal-900/80">
          {insertionPoint ||
            "Browser LLM system prompt — SITE MEMORY block while on this domain (each step until the domain changes)."}
        </p>
      </div>
      {hints.length ? (
        <ul className="space-y-2">
          {hints.map((h, i) => (
            <li
              key={`${h.kind}-${i}-${String(h.content || "").slice(0, 24)}`}
              className="rounded-xl border border-teal-50 bg-teal-50/40 px-3 py-2"
            >
              <div className="mb-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-teal-700/70">
                {h.kind || "note"}
              </div>
              <p className="whitespace-pre-wrap text-sm text-teal-950">{h.content}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-teal-900/60">No hints on this domain profile.</p>
      )}
      {insertedBlock ? (
        <div>
          <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-teal-800/70">
            Exact block in prompt
          </h3>
          <pre className="whitespace-pre-wrap break-words rounded-xl border border-teal-100 bg-teal-50/30 p-3 font-mono text-[0.7rem] leading-relaxed text-teal-950">
            {insertedBlock}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

/**
 * @param {{ learned: object, fallbackContent?: string }} props
 */
function SkillLearnedDetails({ learned, fallbackContent = "" }) {
  const steps = Array.isArray(learned?.steps) ? learned.steps : [];
  const triggers = Array.isArray(learned?.triggers) ? learned.triggers : [];
  return (
    <div className="flex flex-col gap-4 text-sm text-teal-950">
      <p className="text-xs text-teal-800/70">
        <span className="font-semibold text-teal-950">
          {learned?.created ? "New production skill" : "Skill updated"}
        </span>
        {learned?.name ? ` · ${learned.name}` : ""}
        {learned?.slug ? ` · /${learned.slug}` : ""}
      </p>
      {triggers.length ? (
        <div>
          <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-teal-800/70">
            Triggers
          </h3>
          <p className="text-xs text-teal-900/80">{triggers.join(" · ")}</p>
        </div>
      ) : null}
      {steps.length ? (
        <ol className="list-decimal space-y-1 pl-4 text-sm">
          {steps.map((s, i) => (
            <li key={`${i}-${String(s).slice(0, 24)}`}>{s}</li>
          ))}
        </ol>
      ) : (
        <pre className="whitespace-pre-wrap break-words font-mono text-xs text-teal-950">
          {fallbackContent}
        </pre>
      )}
    </div>
  );
}

/**
 * @param {string} content
 * @returns {{ agent: object[], user: object[] }}
 */
function parsePulledFromContent(content) {
  /** @type {object[]} */
  const agent = [];
  /** @type {object[]} */
  const user = [];
  let section = /** @type {null|"agent"|"user"} */ (null);
  for (const line of String(content || "").split(/\n/)) {
    if (/^Agent MEMORY/i.test(line)) {
      section = "agent";
      continue;
    }
    if (/^USER prefs/i.test(line)) {
      section = "user";
      continue;
    }
    const m = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (!m || !section) continue;
    const row = { rank: Number(m[1]), content: m[2].replace(/\s*\[\d+\.\d+\]\s*$/, "").trim() };
    if (section === "agent") agent.push(row);
    else user.push(row);
  }
  return { agent, user };
}

/**
 * @param {{ title: string, rows?: object[], empty: string }} props
 */
function PulledList({ title, rows, empty }) {
  const list = Array.isArray(rows) ? rows : [];
  return (
    <section>
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-teal-900/60">{title}</h3>
      {list.length === 0 ? (
        <p className="text-xs text-teal-900/55">{empty}</p>
      ) : (
        <ol className="space-y-2">
          {list.map((row) => (
            <li
              key={`${row.rank}-${String(row.content || "").slice(0, 40)}`}
              className="rounded-xl border border-teal-50 bg-teal-50/40 px-3 py-2"
            >
              <div className="mb-0.5 flex flex-wrap items-baseline gap-2 text-[0.7rem] font-semibold text-teal-800/60">
                <span>#{row.rank}</span>
                {typeof row.score === "number" && row.score > 0 ? (
                  <span>score {row.score.toFixed(2)}</span>
                ) : null}
              </div>
              <div className="whitespace-pre-wrap break-words">{row.content}</div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * Tiny chip for a whole run segment of ops messages — click opens the event modal.
 * Why: must not look like a chat thread bubble; just a control to open details.
 * @param {{ messages: object[] }} props
 */
export function RunOpsIconRow({ messages }) {
  const list = Array.isArray(messages) ? messages : [];
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  if (!list.length) return null;

  const n = list.length;
  const summary = summarizeOpsKinds(list);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Run log — ${n} events. ${summary}`}
        aria-label={`Open run log, ${n} events`}
        className="yb-ops-chip yb-ops-chip--label self-start inline-flex cursor-pointer items-center justify-center rounded-full border border-teal-100 bg-teal-50/80 font-semibold text-teal-900 transition hover:bg-teal-100 focus:outline-none focus:ring-2 focus:ring-teal-500/40 active:scale-95"
      >
        <span aria-hidden="true" className="leading-none">
          ≡
        </span>
        <span className="leading-none tabular-nums">{n}</span>
      </button>
      {open ? <RunOpsModal messages={list} onClose={close} /> : null}
    </>
  );
}
