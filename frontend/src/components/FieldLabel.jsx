/**
 * @fileoverview Form label row with integrated help tooltip.
 * Purpose: Standard pattern for every labeled input across YamBot forms.
 */

import { HelpTooltip } from "./HelpTooltip.jsx";

/**
 * @param {{
 *   helpId: string,
 *   children: import('react').ReactNode,
 *   className?: string,
 *   required?: boolean,
 * }} props
 */
export function FieldLabel({ helpId, children, className = "", required }) {
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 font-medium text-teal-950 ${className}`}>
      <span>
        {children}
        {required ? <span className="text-red-600"> *</span> : null}
      </span>
      <HelpTooltip helpId={helpId} size="sm" />
    </span>
  );
}

/**
 * @param {{
 *   helpId: string,
 *   children: import('react').ReactNode,
 *   className?: string,
 *   as?: "h1" | "h2" | "h3" | "div",
 * }} props
 */
export function SectionTitle({ helpId, children, className = "", as: Tag = "h2" }) {
  return (
    <Tag
      className={`flex flex-wrap items-center gap-2 text-sm font-semibold text-teal-900/80 ${className}`}
    >
      <span>{children}</span>
      <HelpTooltip helpId={helpId} size="sm" />
    </Tag>
  );
}

/**
 * Banner linking to How To section for the current page.
 * @param {{ helpId: string, title?: string }} props
 */
export function PageGuideBanner({ helpId, title = "Page guide" }) {
  return (
    <div className="flex flex-wrap items-start gap-2 rounded-xl border border-sky-100 bg-sky-50/80 px-3 py-2 text-sm text-sky-950">
      <span className="font-semibold">{title}</span>
      <HelpTooltip helpId={helpId} />
    </div>
  );
}

/**
 * Inline help next to a button.
 * @param {{ helpId: string, children: import('react').ReactNode, className?: string }} props
 */
export function ButtonWithHelp({ helpId, children, className = "" }) {
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      {children}
      <HelpTooltip helpId={helpId} size="sm" />
    </span>
  );
}
