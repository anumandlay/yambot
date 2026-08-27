/**
 * @fileoverview First-run welcome page — guided setup before the full product surface.
 * Purpose: New users register here instead of an empty Chats list.
 * Downstream: App.jsx route; redirects to Chats once setup is complete.
 */

import { useEffect } from "react";
import { Link, Navigate } from "react-router-dom";
import { GettingStartedCard } from "../components/GettingStartedCard.jsx";
import { useSetupStatus } from "../hooks/useSetupStatus.js";

export function StartPage() {
  const { loading, complete } = useSetupStatus();

  useEffect(() => {
    document.title = "Get started · YamBot";
  }, []);

  if (!loading && complete) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-3 py-6 sm:px-4 sm:py-8 md:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-teal-950 sm:text-3xl">
          Welcome to YamBot
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-teal-900/75 sm:text-base">
          Tell an AI agent what to do in plain English. It opens a real browser in the cloud,
          clicks through sites, fills forms, and reports back. Setup takes about two minutes.
        </p>
      </header>

      <GettingStartedCard />

      <section className="rounded-2xl border border-teal-100 bg-white p-4 text-sm text-teal-900/75">
        <h2 className="font-bold text-teal-950">How it works</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            <strong>Settings</strong> — your LLM API key (or OpenAI sign-in) powers agent decisions.
          </li>
          <li>
            <strong>Agent</strong> — a named worker with its own cloud Chromium browser.
          </li>
          <li>
            <strong>Chat</strong> — send a goal like “Find the cheapest flight to NYC next Friday”.
          </li>
          <li>
            <strong>Live Wall</strong> — watch all agent screens at once while they work.
          </li>
        </ol>
        <p className="mt-3 text-xs text-teal-900/60">
          Advanced features (Goals, Workforce, Company CRM, etc.) unlock after setup — find them
          under <strong>More</strong> in the sidebar.
        </p>
      </section>

      {loading ? (
        <p className="text-sm text-teal-900/60">Checking your account…</p>
      ) : (
        <p className="text-sm text-teal-900/60">
          Already finished?{" "}
          <Link to="/" className="font-semibold text-teal-700 underline">
            Go to Chats
          </Link>
        </p>
      )}
    </div>
  );
}
