/**
 * @fileoverview App shell header with nav — mobile-first.
 * Purpose: Brand + links to Chats / Settings / Logout.
 * Downstream: Protected layout.
 */

import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export function AppHeader() {
  const { user, logout } = useAuth();
  const linkClass = ({ isActive }) =>
    `inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold ${
      isActive ? "bg-teal-700 text-white" : "bg-white text-teal-900 border border-teal-100"
    }`;

  return (
    <header className="w-full border-b border-teal-100 bg-white/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-6">
        <Link to="/" className="flex min-h-11 items-center gap-2">
          <span className="inline-block h-8 w-8 rounded-lg bg-gradient-to-br from-teal-600 to-teal-900" />
          <div>
            <div className="text-base font-bold tracking-tight">YamBot</div>
            <div className="text-xs text-teal-800/70">Goals in the browser, results on the web</div>
          </div>
        </Link>
        <nav className="flex flex-wrap items-center gap-2">
          <NavLink to="/agents" className={linkClass}>
            Agents
          </NavLink>
          <NavLink to="/" end className={linkClass}>
            Chats
          </NavLink>
          <NavLink to="/settings" className={linkClass}>
            Settings
          </NavLink>
          <span className="hidden text-sm text-teal-900/70 sm:inline">{user?.email}</span>
          <button
            type="button"
            onClick={logout}
            className="inline-flex min-h-11 items-center rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700"
          >
            Log out
          </button>
        </nav>
      </div>
    </header>
  );
}
