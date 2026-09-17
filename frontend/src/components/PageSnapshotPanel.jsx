/**
 * @fileoverview Page snapshot debug panel — shows what the agent sees each step.
 * Purpose: Live view of DOM observation (interactives, menus, captcha) from task events.
 * Downstream: ChatDetailPage under agent screen (icon variant) or expandable panel.
 */

import { useMemo, useState } from "react";
import { SectionTitle } from "./FieldLabel.jsx";

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
  if (obs.telemetry?.tab_count) {
    lines.push(`Tabs: ${obs.telemetry.tab_count} (active ${obs.telemetry.active_tab ?? 0})`);
  }
  if (obs.frames?.length) {
    lines.push(`Frames: ${obs.frames.length} accessible`);
  }
  if (obs.iframes?.length) {
    lines.push(`Iframes: ${obs.iframes.length}`);
  }
  if (obs.a11y?.yaml) {
    lines.push(`A11y tree: ${obs.a11y.yaml.split("\n").length} lines${obs.a11y.truncated ? " (truncated)" : ""}`);
  }
  if (obs.visionAttached) {
    lines.push("Vision: screenshot attached to LLM this step");
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
      visionAttached: evt.payload?.visionAttached,
      telemetry: evt.payload?.telemetry,
    }));
}

/**
 * Snapshot / layers glyph for the compact icon control.
 * @returns {JSX.Element}
 */
function SnapshotIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M3.5 4.75A1.75 1.75 0 0 1 5.25 3h9.5c.966 0 1.75.784 1.75 1.75v.5a.75.75 0 0 1-1.5 0v-.5a.25.25 0 0 0-.25-.25h-9.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h.5a.75.75 0 0 1 0 1.5h-.5A1.75 1.75 0 0 1 3.5 15.25V4.75Z" />
      <path d="M7.25 6A1.75 1.75 0 0 0 5.5 7.75v7.5c0 .966.784 1.75 1.75 1.75h7.5A1.75 1.75 0 0 0 16.5 15.25v-7.5A1.75 1.75 0 0 0 14.75 6h-7.5Zm-.25 1.75a.25.25 0 0 1 .25-.25h7.5a.25.25 0 0 1 .25.25v7.5a.25.25 0 0 1-.25.25h-7.5a.25.25 0 0 1-.25-.25v-7.5Z" />
    </svg>
  );
}

/**
 * @param {{
 *   events?: object[],
 *   className?: string,
 *   compact?: boolean,
 *   variant?: "panel"|"icon"|"drawer",
 *   open?: boolean,
 *   onOpenChange?: (open: boolean) => void,
 * }} props
 */
export function PageSnapshotPanel({
  events,
  className = "",
  compact = false,
  variant = "panel",
  open: openProp,
  onOpenChange,
}) {
  const snapshots = useMemo(() => snapshotsFromTaskEvents(events), [events]);
  const [openLocal, setOpenLocal] = useState(variant !== "icon");
  const [view, setView] = useState("summary");
  const [selected, setSelected] = useState(-1);
  const open = openProp !== undefined ? Boolean(openProp) : openLocal;

  /**
   * @param {boolean} next
   */
  function setOpen(next) {
    if (onOpenChange) onOpenChange(next);
    else setOpenLocal(next);
  }

  const activeIndex = selected >= 0 && selected < snapshots.length ? selected : snapshots.length - 1;
  const current = snapshots[activeIndex]?.pageObservation || null;
  const currentState = snapshots[activeIndex]?.pageState;
  const currentDiff = snapshots[activeIndex]?.stateDiff;
  const currentPlan = snapshots[activeIndex]?.plan;
  const currentProgress = snapshots[activeIndex]?.progress;
  const currentVision = snapshots[activeIndex]?.visionAttached;
  const currentTelemetry = snapshots[activeIndex]?.telemetry;
  const displayObs =
    current && (currentState || currentDiff || currentPlan || currentProgress)
      ? {
          ...current,
          pageState: currentState || current.pageState,
          stateDiff: currentDiff || current.stateDiff,
          plan: currentPlan || current.plan,
          progress: currentProgress || current.progress,
          structures: snapshots[activeIndex]?.structures || current.structures,
          visionAttached: currentVision ?? current.visionAttached,
          telemetry: currentTelemetry || current.telemetry,
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

  /**
   * Shared body for panel and icon-popover expand.
   * @returns {JSX.Element}
   */
  function renderBody() {
    if (!snapshots.length) {
      return (
        <p className="px-3 py-2 text-xs text-teal-900/60">
          Waiting for an agent step… then you’ll see refs, roles, and labels the LLM used.
        </p>
      );
    }
    return (
      <div className="flex min-h-0 flex-col">
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
          {snapshots.length > 1 ? (
            <select
              className="ml-auto max-w-[10rem] rounded-lg border border-teal-100 bg-white px-2 py-1 text-xs"
              value={String(activeIndex)}
              onChange={(e) => setSelected(Number(e.target.value))}
            >
              {snapshots.map((s, i) => (
                <option key={s.eventIndex} value={String(i)}>
                  Step {s.step ?? i + 1}
                </option>
              ))}
            </select>
          ) : null}
          {view === "json" ? (
            <button
              type="button"
              onClick={copyJson}
              className="rounded-lg border border-teal-100 px-2.5 py-1 text-xs font-semibold text-teal-800"
            >
              Copy
            </button>
          ) : null}
        </div>
        <div
          className={`yb-scroll-x overflow-auto p-2 text-xs ${
            compact || variant === "icon" ? "max-h-40 sm:max-h-48" : "max-h-64 sm:max-h-72"
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
                      {[
                        el.overlay ? "overlay" : "",
                        el.hasSubmenu ? "submenu" : "",
                        el.frameId && el.frameId !== "main" ? el.frameId : "",
                        el.shadowHost ? "shadow" : "",
                      ]
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
        {count ? (
          <p className="border-t border-teal-50 px-2 py-1 text-[0.65rem] text-teal-800/60">
            {count} elements · step {snapshots[activeIndex]?.step ?? activeIndex + 1}
          </p>
        ) : null}
      </div>
    );
  }

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-teal-900 ${
          open
            ? "border-teal-500 bg-teal-100"
            : "border-teal-200 bg-white hover:bg-teal-50"
        } ${className}`}
        title="Page snapshot"
        aria-label="Page snapshot"
        aria-pressed={open}
      >
        <SnapshotIcon />
        {snapshots.length ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-teal-700 px-0.5 text-[0.55rem] font-bold text-white">
            {snapshots.length > 9 ? "9+" : snapshots.length}
          </span>
        ) : null}
      </button>
    );
  }

  if (variant === "drawer") {
    return (
      <div
        className={`overflow-hidden rounded-2xl border border-teal-100 bg-white shadow-sm ${className}`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-teal-50 px-3 py-2">
          <SectionTitle as="span" helpId="chat.snapshot" className="inline-flex text-xs">
            Page snapshot
          </SectionTitle>
        </div>
        {renderBody()}
      </div>
    );
  }

  const shellClass = `flex shrink-0 flex-col overflow-hidden rounded-2xl border border-teal-100 bg-white shadow-sm ${className}`;

  return (
    <details
      className={shellClass}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="flex shrink-0 cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex flex-wrap items-center gap-2">
          <SectionTitle as="span" helpId="chat.snapshot" className="inline-flex">
            Page snapshot
          </SectionTitle>
          {snapshots.length ? (
            <span className="rounded-lg bg-teal-50 px-2 py-0.5 font-mono text-xs text-teal-800">
              {count} elements
            </span>
          ) : (
            <span className="text-xs font-normal text-teal-800/50">waiting for agent step…</span>
          )}
        </span>
      </summary>
      <div className="border-t border-teal-50">{renderBody()}</div>
    </details>
  );
}
