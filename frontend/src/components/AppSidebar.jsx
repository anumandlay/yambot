/**
 * @fileoverview Left app sidebar with collapse/toggle — replaces the old top nav.
 * Purpose: Mobile drawer + desktop sticky rail for Agents / Chats / System / Settings.
 * Downstream: ProtectedLayout in App.jsx.
 */

import { useEffect } from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

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

  // Why: lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const linkClass = ({ isActive }) =>
    `flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors ${
      isActive
        ? "bg-teal-700 text-white"
        : "text-teal-950 hover:bg-teal-50 border border-transparent hover:border-teal-100"
    } ${collapsed ? "justify-center px-2 lg:px-2" : ""}`;

  const nav = (
    <nav className="flex flex-1 flex-col gap-1.5 p-3" aria-label="Main">
      <NavLink to="/agents" className={linkClass} onClick={onClose} title="Agents">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-100 text-xs font-bold text-teal-800">
          A
        </span>
        {!collapsed ? <span>Agents</span> : null}
      </NavLink>
      <NavLink to="/goals" className={linkClass} onClick={onClose} title="Goals">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-100 text-xs font-bold text-teal-800">
          G
        </span>
        {!collapsed ? <span>Goals</span> : null}
      </NavLink>
      <NavLink to="/live" className={linkClass} onClick={onClose} title="Live Wall">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-100 text-xs font-bold text-teal-800">
          L
        </span>
        {!collapsed ? <span>Live Wall</span> : null}
      </NavLink>
      <NavLink to="/" end className={linkClass} onClick={onClose} title="Chats">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-100 text-xs font-bold text-teal-800">
          C
        </span>
        {!collapsed ? <span>Chats</span> : null}
      </NavLink>
      <NavLink to="/workforce" className={linkClass} onClick={onClose} title="Workforce">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-100 text-xs font-bold text-teal-800">
          W
        </span>
        {!collapsed ? <span>Workforce</span> : null}
      </NavLink>
      <NavLink to="/policies" className={linkClass} onClick={onClose} title="Policies">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-100 text-xs font-bold text-teal-800">
          P
        </span>
        {!collapsed ? <span>Policies</span> : null}
      </NavLink>
      <NavLink to="/governance" className={linkClass} onClick={onClose} title="Governance">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-100 text-xs font-bold text-teal-800">
          ⊛
        </span>
        {!collapsed ? <span>Governance</span> : null}
      </NavLink>
      <NavLink to="/system" className={linkClass} onClick={onClose} title="System">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-100 text-xs font-bold text-teal-800">
          S
        </span>
        {!collapsed ? <span>System</span> : null}
      </NavLink>
      <NavLink to="/settings" className={linkClass} onClick={onClose} title="Settings">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-100 text-xs font-bold text-teal-800">
          ⚙
        </span>
        {!collapsed ? <span>Settings</span> : null}
      </NavLink>
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
        className={`fixed inset-y-0 left-0 z-50 flex w-[min(18rem,88vw)] flex-col border-r border-teal-100 bg-white pt-[env(safe-area-inset-top,0px)] shadow-lg transition-transform duration-200 lg:static lg:z-20 lg:h-auto lg:min-h-full lg:shadow-none ${
          collapsed ? "lg:w-[4.5rem]" : "lg:w-56"
        } ${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div
          className={`flex items-center gap-2 border-b border-teal-100 px-3 py-3 ${
            collapsed ? "lg:justify-center lg:px-2" : ""
          }`}
        >
          <Link
            to="/"
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

        <div className={`mt-auto border-t border-teal-100 p-3 ${collapsed ? "lg:px-2" : ""}`}>
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
