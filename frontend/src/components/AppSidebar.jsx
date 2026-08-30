/**
 * @fileoverview Left app sidebar with collapse/toggle — replaces the old top nav.
 * Purpose: Mobile drawer + desktop sticky rail grouped into Start / More / Account.
 * Downstream: ProtectedLayout in App.jsx.
 */

import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useHelp } from "../context/HelpContext.jsx";
import { useSetupStatus } from "../hooks/useSetupStatus.js";
import { HelpTooltip } from "./HelpTooltip.jsx";
import { HelpToggle } from "./HelpToggle.jsx";

const MORE_COLLAPSE_KEY = "yambot.sidebar.moreCollapsed";

/**
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   collapsed: boolean,
 *   onToggleCollapsed: () => void,
 * }} props
 */
export function AppSidebar({ open, onClose, collapsed, onToggleCollapsed }) {
  const { user, logout } = useAuth();
  const { helpEnabled } = useHelp();
  const { complete: setupComplete } = useSetupStatus();
  const [moreCollapsed, setMoreCollapsed] = useState(() => {
    try {
      return localStorage.getItem(MORE_COLLAPSE_KEY) !== "0";
    } catch {
      return true;
    }
  });

  // Why: lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    try {
      localStorage.setItem(MORE_COLLAPSE_KEY, moreCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [moreCollapsed]);

  const linkClass = ({ isActive }) =>
    `flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors ${
      isActive
        ? "bg-teal-700 text-white"
        : "text-teal-950 hover:bg-teal-50 border border-transparent hover:border-teal-100"
    } ${collapsed ? "justify-center px-2 lg:px-2" : ""}`;

  /**
   * @param {{ to: string, helpId: string, letter: string, label: string, end?: boolean }} props
   */
  function NavItem({ to, helpId, letter, label, end = false }) {
    return (
      <NavLink to={to} end={end} className={linkClass} onClick={onClose} title={label}>
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-100 text-xs font-bold text-teal-800">
          {letter}
        </span>
        {!collapsed ? (
          <span className="inline-flex min-w-0 flex-1 items-center gap-1">
            <span className="truncate">{label}</span>
            <HelpTooltip helpId={helpId} size="sm" />
          </span>
        ) : null}
      </NavLink>
    );
  }

  /**
   * @param {{ label: string }} props
   */
  function SectionLabel({ label }) {
    if (collapsed) return null;
    return (
      <div className="px-3 pb-1 pt-2 text-[0.65rem] font-bold uppercase tracking-wider text-teal-800/50">
        {label}
      </div>
    );
  }

  const nav = (
    <nav
      className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain p-3"
      aria-label="Main"
    >
      {user?.isSuperAdmin || user?.role === "superadmin" ? (
        <NavItem to="/admin/users" helpId="admin.nav" letter="SA" label="Super admin" />
      ) : null}

      {!setupComplete ? (
        <NavItem to="/start" helpId="nav.start" letter="★" label="Get started" />
      ) : null}

      <SectionLabel label="Start here" />
      <NavItem to="/business" helpId="nav.business" letter="B" label="Business setup" />
      <NavItem to="/agent-actions" helpId="nav.agentActions" letter="⚡" label="Agent actions" />
      <NavItem to="/" helpId="nav.chats" letter="C" label="Chats" end />
      <NavItem to="/agents" helpId="nav.agents" letter="A" label="Agents" />
      <NavItem to="/live" helpId="nav.live" letter="L" label="Live Wall" />
      <NavItem to="/goals" helpId="nav.goals" letter="G" label="Scheduled goals" />

      {helpEnabled ? (
        <NavItem to="/how-to" helpId="nav.howto" letter="?" label="How To" />
      ) : null}

      {/* Why: enterprise modules overwhelm new users — tuck them under a collapsible group. */}
      {collapsed ? (
        <>
          <NavItem to="/workforce" helpId="nav.workforce" letter="W" label="Workforce" />
          <NavItem to="/operations" helpId="nav.operations" letter="O" label="Operations" />
          <NavItem to="/queues" helpId="nav.queues" letter="Q" label="Queues" />
          <NavItem to="/deals" helpId="nav.deals" letter="D" label="Deals" />
          <NavItem to="/invoices" helpId="nav.invoices" letter="Inv" label="Invoices" />
          <NavItem to="/company" helpId="nav.company" letter="Co" label="Company" />
          <NavItem to="/skills" helpId="nav.skills" letter="Sk" label="Workflows" />
          <NavItem to="/policies" helpId="nav.policies" letter="P" label="Policies" />
          <NavItem to="/governance" helpId="nav.governance" letter="⊛" label="Governance" />
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setMoreCollapsed((v) => !v)}
            className="mt-2 flex min-h-9 items-center justify-between rounded-lg px-3 text-[0.65rem] font-bold uppercase tracking-wider text-teal-800/50 hover:bg-teal-50"
            aria-expanded={!moreCollapsed}
          >
            <span>More</span>
            <span aria-hidden>{moreCollapsed ? "▸" : "▾"}</span>
          </button>
          {!moreCollapsed ? (
            <div className="flex flex-col gap-0.5">
              <NavItem to="/workforce" helpId="nav.workforce" letter="W" label="Workforce" />
              <NavItem to="/operations" helpId="nav.operations" letter="O" label="Operations" />
              <NavItem to="/queues" helpId="nav.queues" letter="Q" label="Queues" />
              <NavItem to="/deals" helpId="nav.deals" letter="D" label="Deals" />
              <NavItem to="/invoices" helpId="nav.invoices" letter="Inv" label="Invoices" />
              <NavItem to="/company" helpId="nav.company" letter="Co" label="Company" />
              <NavItem to="/skills" helpId="nav.skills" letter="Sk" label="Workflows" />
              <NavItem to="/policies" helpId="nav.policies" letter="P" label="Policies" />
              <NavItem to="/governance" helpId="nav.governance" letter="⊛" label="Governance" />
            </div>
          ) : null}
        </>
      )}

      <SectionLabel label="Account" />
      <NavItem to="/settings" helpId="nav.settings" letter="⚙" label="Settings" />
      <NavItem to="/wallet" helpId="nav.wallet" letter="$" label="Wallet" />
      <NavItem to="/system" helpId="nav.system" letter="S" label="System" />
    </nav>
  );

  return (
    <>
      {/* Mobile backdrop */}
      <button
        type="button"
        aria-label="Close menu"
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-dvh max-h-dvh min-h-0 w-[min(18rem,88vw)] flex-col overflow-hidden border-r border-teal-100 bg-white pt-[env(safe-area-inset-top,0px)] shadow-lg transition-transform duration-200 lg:static lg:z-20 lg:h-full lg:max-h-dvh lg:min-h-0 lg:shadow-none ${
          collapsed ? "lg:w-[4.5rem]" : "lg:w-56"
        } ${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div
          className={`flex shrink-0 items-center gap-2 border-b border-teal-100 px-3 py-3 ${
            collapsed ? "lg:justify-center lg:px-2" : ""
          }`}
        >
          <Link
            to={setupComplete ? "/" : "/start"}
            onClick={onClose}
            className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 ${
              collapsed ? "lg:flex-none lg:justify-center" : ""
            }`}
          >
            <span className="inline-block h-8 w-8 shrink-0 rounded-lg bg-gradient-to-br from-teal-600 to-teal-900" />
            {!collapsed ? (
              <div className="min-w-0 lg:block">
                <div className="truncate text-base font-bold tracking-tight">YamBot</div>
                <div className="truncate text-[0.65rem] text-teal-800/70">Browser agents</div>
              </div>
            ) : null}
          </Link>
          <button
            type="button"
            className="hidden min-h-11 min-w-11 items-center justify-center rounded-xl border border-teal-100 text-teal-900 lg:inline-flex"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? "»" : "«"}
          </button>
          <button
            type="button"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-teal-100 lg:hidden"
            onClick={onClose}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        {nav}

        <div className={`shrink-0 border-t border-teal-100 p-3 ${collapsed ? "lg:px-2" : ""}`}>
          {collapsed ? (
            <div className="mb-2 flex justify-center">
              <HelpToggle compact />
            </div>
          ) : (
            <HelpToggle className="mb-2" />
          )}
        </div>

        <div className={`shrink-0 border-t border-teal-100 p-3 ${collapsed ? "lg:px-2" : ""}`}>
          {!collapsed ? (
            <p className="mb-2 truncate px-1 text-xs text-teal-900/60" title={user?.email}>
              {user?.email}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => {
              onClose();
              logout();
            }}
            className={`flex min-h-11 w-full items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 ${
              collapsed ? "justify-center lg:px-2" : ""
            }`}
            title="Log out"
          >
            <span aria-hidden>⎋</span>
            {!collapsed ? <span>Log out</span> : null}
          </button>
        </div>
      </aside>
    </>
  );
}
