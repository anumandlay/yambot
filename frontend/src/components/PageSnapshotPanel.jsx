/**
 * @fileoverview Page snapshot debug panel — shows what the agent sees each step.
 * Purpose: Live view of DOM observation (interactives, menus, captcha) from task events.
 * Downstream: ChatDetailPage right rail; reads `thinking` events with `pageObservation`.
 */

import { useMemo, useState } from "react";

/**
 * @param {object|null|undefined} obs
 * @returns {string}
 */
export function formatPageObservationText(obs) {
  if (!obs) return "";
  const lines = [
    `URL: ${obs.url || ""}`,
    `Title: ${obs.title || ""}`,
    `CAPTCHA: ${obs.captcha?.present ? (obs.captcha.signals || []).join(",") : "none"}`,
    `Interactives: ${obs.interactiveCount ?? (obs.interactives || []).length}`,
  ];
  if (obs.pageState) {
    const ps = obs.pageState;
    lines.push(
      `State: modal=${ps.ui?.modal_open} menu=${ps.ui?.menu_open} loading=${ps.ui?.loading} auth=${ps.auth?.state || "unknown"}`
    );
    if (ps.errors?.length) {
      lines.push(`Errors: ${ps.errors.map((e) => e.message).join("; ")}`);
    }
  }
  if (obs.stateDiff) {
    const d = obs.stateDiff;
    const parts = [];
    if (d.url_changed) parts.push("url");
    if (d.dom_changed) parts.push(`dom(+${(d.added_refs || []).length}/-${(d.removed_refs || []).length})`);
    if (parts.length) lines.push(`Changes: ${parts.join(", ")}`);
  }
  if (obs.progress) {
    lines.push(
      `Progress: ${Math.round((obs.progress.score || 0) * 100)}% — ${obs.progress.label || ""}`
    );
  }
  if (obs.plan?.subgoals?.length) {
    const done = obs.plan.subgoals.filter((s) => s.status === "done").length;
    lines.push(`Plan: ${done}/${obs.plan.subgoals.length} subgoals done`);
  }
  if (obs.structures?.tables?.length) {
    lines.push(`Tables: ${obs.structures.tables.length}`);
  }
  if (obs.structures?.forms?.length) {
    lines.push(`Forms: ${obs.structures.forms.length}`);
  }
  if (Array.isArray(obs.openMenus) && obs.openMenus.length) {
    lines.push("Open menus:");
    for (const menu of obs.openMenus) {
      lines.push(`Menu ${(menu.menuIndex ?? 0) + 1}:`);
      for (const item of menu.items || []) {
        const flags = [
          item.hasSubmenu ? "submenu" : "",
          item.checked ? `checked=${item.checked}` : "",
        ]
          .filter(Boolean)
          .join(", ");
        lines.push(`  - "${item.name}"${flags ? ` [${flags}]` : ""}`);
      }
    }
  }
  lines.push("Interactive elements:");
  for (const el of obs.interactives || []) {
    lines.push(
      `- ${el.ref}: <${el.tag}${el.type ? ` type=${el.type}` : ""}${
        el.role ? ` role=${el.role}` : ""
      }> "${el.name}"${el.cssHint ? ` css=${el.cssHint}` : ""}${
        el.overlay ? " [overlay]" : ""
      }${el.hasSubmenu ? " [submenu]" : ""}${el.href ? ` href=${el.href}` : ""}${
        el.value ? ` value=${el.value}` : ""
      }${el.xpath ? ` xpath=${String(el.xpath).slice(0, 120)}` : ""}`
    );
  }
  lines.push("Page text (truncated):");
  lines.push(obs.text || "");
  return lines.join("\n");
}

/**
 * @param {object[]} events
 * @returns {object[]}
 */
export function snapshotsFromTaskEvents(events) {
  return (events || [])
    .map((evt, eventIndex) => ({ evt, eventIndex }))
    .filter(({ evt }) => evt.type === "thinking" && evt.payload?.pageObservation)
    .map(({ evt, eventIndex }) => ({
      eventIndex,
      step: evt.payload?.step ?? null,
      url: evt.payload?.pageObservation?.url || evt.payload?.url || "",
      title: evt.payload?.pageObservation?.title || evt.payload?.title || "",
      pageObservation: evt.payload.pageObservation,
      pageState: evt.payload?.pageState,
      stateDiff: evt.payload?.stateDiff,
      plan: evt.payload?.plan,
      progress: evt.payload?.progress,
      structures: evt.payload?.structures,
    }));
}

/**
 * @param {{ events?: object[], className?: string, compact?: boolean }} props
 */
export function PageSnapshotPanel({ events, className = "", compact = false }) {
  const snapshots = useMemo(() => snapshotsFromTaskEvents(events), [events]);
  const [open, setOpen] = useState(true);
  const [view, setView] = useState("summary");
  const [selected, setSelected] = useState(-1);

  const activeIndex = selected >= 0 && selected < snapshots.length ? selected : snapshots.length - 1;
  const current = snapshots[activeIndex]?.pageObservation || null;
  const currentState = snapshots[activeIndex]?.pageState;
  const currentDiff = snapshots[activeIndex]?.stateDiff;
  const currentPlan = snapshots[activeIndex]?.plan;
  const currentProgress = snapshots[activeIndex]?.progress;
  const displayObs =
    current && (currentState || currentDiff || currentPlan || currentProgress)
      ? {
          ...current,
          pageState: currentState || current.pageState,
          stateDiff: currentDiff || current.stateDiff,
          plan: currentPlan || current.plan,
          progress: currentProgress || current.progress,
          structures: snapshots[activeIndex]?.structures || current.structures,
        }
      : current;
  const count = displayObs?.interactiveCount ?? displayObs?.interactives?.length ?? 0;

  async function copyJson() {
    if (!displayObs) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(displayObs, null, 2));
    } catch {
      /* ignore */
    }
  }

  const shellClass = `flex min-h-0 flex-col overflow-hidden rounded-2xl border border-teal-100 bg-white shadow-sm ${
    compact ? "h-full [&[open]]:flex [&[open]]:min-h-0 [&[open]]:flex-1 [&[open]]:flex-col" : ""
  } ${className}`;

  if (!snapshots.length) {
    return (
      <details className={shellClass} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="shrink-0 cursor-pointer list-none px-3 py-2 text-sm font-semibold text-teal-900/80 [&::-webkit-details-marker]:hidden">
          Page snapshot
          <span className="ml-2 text-xs font-normal text-teal-800/50">waiting for agent step…</span>
        </summary>
        {!compact ? (
          <p className="border-t border-teal-50 px-3 py-2 text-xs text-teal-900/60">
            When the agent runs, each step stores what it sees on the page (refs, roles, labels, xpath).
          </p>
        ) : null}
      </details>
    );
  }

  return (
    <details className={shellClass} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="flex shrink-0 cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm font-semibold text-teal-900/80 [&::-webkit-details-marker]:hidden">
        <span>
          Page snapshot
          <span className="ml-2 rounded-lg bg-teal-50 px-2 py-0.5 font-mono text-xs text-teal-800">
            {count} elements
          </span>
        </span>
        {snapshots.length > 1 ? (
          <select
            className="max-w-[12rem] rounded-lg border border-teal-100 bg-white px-2 py-1 text-xs font-normal"
            value={String(activeIndex)}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setSelected(Number(e.target.value))}
          >
            {snapshots.map((s, i) => (
              <option key={s.eventIndex} value={String(i)}>
                Step {s.step ?? i + 1}
                {s.title ? ` — ${s.title.slice(0, 28)}` : ""}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs font-normal text-teal-800/50">
            step {snapshots[0]?.step ?? 1}
          </span>
        )}
      </summary>

      <div className="flex min-h-0 flex-1 flex-col border-t border-teal-50">
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-teal-50 px-2 py-2">
          {[
            ["summary", "Summary"],
            ["table", "Table"],
            ["json", "Raw JSON"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                view === id ? "bg-teal-700 text-white" : "bg-teal-50 text-teal-900"
              }`}
            >
              {label}
            </button>
          ))}
          {view === "json" ? (
            <button
              type="button"
              onClick={copyJson}
              className="ml-auto rounded-lg border border-teal-100 px-2.5 py-1 text-xs font-semibold text-teal-800"
            >
              Copy
            </button>
          ) : null}
        </div>

        <div
          className={`yb-scroll-x min-h-0 overflow-auto p-2 text-xs ${
            compact ? "flex-1" : "max-h-64 sm:max-h-72"
          }`}
        >
          {view === "json" ? (
            <pre className="whitespace-pre-wrap break-all font-mono text-[0.68rem] text-teal-950">
              {JSON.stringify(displayObs, null, 2)}
            </pre>
          ) : null}

          {view === "summary" ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-[0.68rem] leading-relaxed text-teal-950">
              {formatPageObservationText(displayObs)}
            </pre>
          ) : null}

          {view === "table" && displayObs ? (
            <table className="min-w-full text-left font-mono text-[0.68rem]">
              <thead className="sticky top-0 bg-white text-teal-900/60">
                <tr>
                  <th className="px-1 py-1">ref</th>
                  <th className="px-1 py-1">role</th>
                  <th className="px-1 py-1">name</th>
                  <th className="px-1 py-1">tag</th>
                  <th className="px-1 py-1">flags</th>
                </tr>
              </thead>
              <tbody>
                {(displayObs.interactives || []).map((el) => (
                  <tr key={el.ref} className="border-t border-teal-50 align-top">
                    <td className="px-1 py-1 font-bold text-teal-800">{el.ref}</td>
                    <td className="px-1 py-1">{el.role || "—"}</td>
                    <td className="max-w-[10rem] break-words px-1 py-1">{el.name || "—"}</td>
                    <td className="whitespace-nowrap px-1 py-1">
                      {el.tag}
                      {el.type ? `:${el.type}` : ""}
                    </td>
                    <td className="px-1 py-1 text-teal-800/70">
                      {[el.overlay ? "overlay" : "", el.hasSubmenu ? "submenu" : ""]
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>
    </details>
  );
}
