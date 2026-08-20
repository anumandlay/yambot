/**
 * @fileoverview App shell header with nav — mobile-first.
 * Purpose: Brand + links to Agents / Chats / Settings / Logout; sticky on scroll.
 * Downstream: Protected layout.
 */

import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export function AppHeader() {
  const { user, logout } = useAuth();
  const linkClass = ({ isActive }) =>
    `inline-flex shrink-0 min-h-11 items-center rounded-xl px-3 text-sm font-semibold ${
      isActive ? "bg-teal-700 text-white" : "bg-white text-teal-900 border border-teal-100"
    }`;

  return (
    <header className="sticky top-0 z-40 w-full border-b border-teal-100 bg-white/90 pt-[env(safe-area-inset-top,0px)] backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-3 md:flex-row md:items-center md:justify-between md:px-6">
        <Link to="/" className="flex min-h-11 min-w-0 items-center gap-2">
          <span className="inline-block h-8 w-8 shrink-0 rounded-lg bg-gradient-to-br from-teal-600 to-teal-900" />
          <div className="min-w-0">
            <div className="truncate text-base font-bold tracking-tight">YamBot</div>
            <div className="hidden truncate text-xs text-teal-800/70 sm:block">
              Goals in the browser, results on the web
            </div>
          </div>
        </Link>
        <nav
          className="yb-scroll-x flex w-full items-center gap-2 pb-0.5 md:w-auto md:justify-end"
          aria-label="Main"
        >
          <NavLink to="/agents" className={linkClass}>
            Agents
          </NavLink>
          <NavLink to="/" end className={linkClass}>
            Chats
          </NavLink>
          <NavLink to="/settings" className={linkClass}>
            Settings
          </NavLink>
          <span className="hidden shrink-0 text-sm text-teal-900/70 lg:inline">
            {user?.email}
          </span>
          <button
            type="button"
            onClick={logout}
            className="inline-flex min-h-11 shrink-0 items-center rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700"
          >
            Log out
          </button>
        </nav>
      </div>
    </header>
  );
}
