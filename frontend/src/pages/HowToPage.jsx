/**
 * @fileoverview YamBot How To guide — full product manual with table of contents.
 * Purpose: Detailed explanations for agents, goals, skills, governance, and all features.
 * Downstream: Linked from HelpTooltip and sidebar; anchor navigation per section.
 */

import { useEffect } from "react";
import { Link } from "react-router-dom";
import { HOW_TO_SECTIONS } from "../help/helpContent.js";
import { HelpTooltip } from "../components/HelpTooltip.jsx";

export function HowToPage() {
  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (!hash) return;
    const el = document.getElementById(hash);
    if (el) {
      requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-3 py-4 sm:px-4 sm:py-8 md:px-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">How To — YamBot manual</h1>
          <HelpTooltip helpId="nav.howto" />
        </div>
        <p className="text-sm leading-relaxed text-teal-900/75">
          Complete guide to creating agents, running chats, managing goals, skills, workforce
          delegation, operations, and governance. Every field in the app also has a{" "}
          <strong className="rounded-full border border-teal-200 bg-teal-50 px-1.5 text-teal-800">
            ?
          </strong>{" "}
          icon with detailed context help.
        </p>
      </header>

      <nav
        className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm"
        aria-label="Table of contents"
      >
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-teal-900/60">
          Contents
        </h2>
        <ol className="flex flex-col gap-2 text-sm">
          {HOW_TO_SECTIONS.map((s, i) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="font-semibold text-teal-800 underline decoration-teal-200 underline-offset-2 hover:decoration-teal-600"
              >
                {i + 1}. {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="flex flex-col gap-8">
        {HOW_TO_SECTIONS.map((section) => (
          <article
            key={section.id}
            id={section.id}
            className="scroll-mt-20 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm sm:p-6"
          >
            <h2 className="text-lg font-bold text-teal-950 sm:text-xl">{section.title}</h2>
            <div className="mt-3 text-sm leading-relaxed text-teal-900/85">
              {section.body.split("\n\n").map((para, i) => (
                <p key={i} className={i > 0 ? "mt-3" : ""}>
                  {para}
                </p>
              ))}
            </div>
          </article>
        ))}
      </div>

      <footer className="rounded-xl border border-teal-100 bg-teal-50/50 p-4 text-sm text-teal-900/80">
        <p>
          Quick links:{" "}
          <Link to="/agents/new" className="font-semibold text-teal-800 underline">
            New agent
          </Link>
          {" · "}
          <Link to="/settings" className="font-semibold text-teal-800 underline">
            Settings
          </Link>
          {" · "}
          <Link to="/goals/new" className="font-semibold text-teal-800 underline">
            New goal
          </Link>
          {" · "}
          <Link to="/skills" className="font-semibold text-teal-800 underline">
            Skills
          </Link>
        </p>
      </footer>
    </div>
  );
}
