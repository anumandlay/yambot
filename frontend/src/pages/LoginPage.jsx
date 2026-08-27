/**
 * @fileoverview Login page.
 * Purpose: Authenticate existing users and store JWT for the web app.
 */

import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useHelp } from "../context/HelpContext.jsx";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { ButtonWithHelp, FieldLabel } from "../components/FieldLabel.jsx";
import { HelpToggle } from "../components/HelpToggle.jsx";

export function LoginPage() {
  const { user, login } = useAuth();
  const { helpEnabled } = useHelp();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  /**
   * @param {React.FormEvent} e
   */
  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login({ email, password });
      navigate("/start");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-3 py-8 sm:px-4 sm:py-10 md:px-0">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Sign in to YamBot</h1>
        <HelpToggle compact />
      </div>
      <p className="text-sm text-teal-900/70">
        Enter goals on the web. Your agent&apos;s cloud computer runs them in Chromium.
        {helpEnabled ? (
          <>
            {" "}
            <Link className="font-semibold text-teal-700 underline" to="/how-to">
              How To guide
            </Link>
          </>
        ) : null}
      </p>
      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}
      <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="auth.email">Email</FieldLabel>
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="auth.password">Password</FieldLabel>
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <ButtonWithHelp helpId="auth.login">
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </ButtonWithHelp>
      </form>
      <p className="text-sm">
        No account?{" "}
        <Link className="font-semibold text-teal-700 underline" to="/register">
          Create one
        </Link>
        {" · "}
        <Link className="font-semibold text-violet-800 underline" to="/admin/login">
          Platform admin
        </Link>
      </p>
    </div>
  );
}
