/**
 * @fileoverview Inline notice for which skill was selected and why.
 * Purpose: Rendered in chat thread (system/user meta) and active-run status bar.
 */

import { HelpTooltip } from "./HelpTooltip.jsx";
import { skillPickSourceLabel } from "../lib/skillPick.js";

/**
 * @param {{
 *   pick: import("../lib/skillPick.js").SkillPick,
 *   compact?: boolean,
 *   className?: string,
 * }} props
 */
export function SkillPickNotice({ pick, compact = false, className = "" }) {
  if (!pick) return null;

  const label = skillPickSourceLabel(pick.source);
  const name = pick.skillName || pick.templateId;
  const slugPart = pick.slug ? ` (/${pick.slug})` : "";
  const isNone = pick.source === "none";

  if (compact) {
    return (
      <span className={`inline-flex flex-wrap items-center gap-1.5 text-xs ${className}`}>
        <span
          className={`rounded-full px-2 py-0.5 font-semibold ${
            isNone ? "bg-slate-100 text-slate-700" : "bg-violet-100 text-violet-900"
          }`}
        >
          {label}
        </span>
        {name ? (
          <span className="font-medium text-teal-950">
            {name}
            {slugPart}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <div
      className={`rounded-xl border px-3 py-2 text-xs ${
        isNone
          ? "border-slate-200 bg-slate-50 text-slate-700"
          : "border-violet-100 bg-violet-50 text-violet-950"
      } ${className}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="rounded-full bg-white/80 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide">
            {label}
          </span>
          <HelpTooltip helpId="chat.skillPick" size="sm" />
        </span>
        {name ? (
          <span className="font-semibold">
            {name}
            {slugPart}
          </span>
        ) : null}
      </div>
      {pick.reason ? <p className="mt-1.5 leading-snug opacity-90">{pick.reason}</p> : null}
      {pick.matchedTriggers?.length ? (
        <p className="mt-1 text-[0.65rem] opacity-75">
          Matched patterns: {pick.matchedTriggers.join(", ")}
        </p>
      ) : null}
    </div>
  );
}
