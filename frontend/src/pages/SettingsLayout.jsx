/**
 * @fileoverview Settings layout — submenu for API key vs OpenAI OAuth.
 * Purpose: Group LLM credential methods under /settings without mixing forms on one page.
 * Downstream: React Router nested routes for SettingsLlmPage and SettingsOpenAiPage.
 */

import { NavLink, Outlet } from "react-router-dom";
import { HelpToggle } from "../components/HelpToggle.jsx";
import { PageGuideBanner } from "../components/FieldLabel.jsx";

const tabClass = ({ isActive }) =>
  `min-h-10 rounded-xl px-4 py-2 text-sm font-semibold transition ${
    isActive
      ? "bg-teal-700 text-white shadow-sm"
      : "border border-teal-100 bg-white text-teal-900 hover:bg-teal-50"
  }`;

/**
 * Settings shell with submenu tabs and nested page outlet.
 */
export function SettingsLayout() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      <HelpToggle />
      <PageGuideBanner helpId="nav.settings" />

      <nav className="flex flex-wrap gap-2" aria-label="Settings sections">
        <NavLink to="/settings/llm" className={tabClass} end>
          Default API key
        </NavLink>
        <NavLink to="/settings/llms" className={tabClass}>
          LLM profiles
        </NavLink>
        <NavLink to="/settings/openai" className={tabClass}>
          OpenAI OAuth
        </NavLink>
      </nav>

      <Outlet />
    </div>
  );
}
