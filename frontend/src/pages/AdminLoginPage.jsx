/**
 * @fileoverview Super-admin login — platform operator entry (SaaS).
 * Purpose: Dedicated sign-in that only proceeds to admin console for superadmin role.
 * Downstream: AuthContext login; redirects to /admin/users.
 */

import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { FieldLabel, ButtonWithHelp } from "../components/FieldLabel.jsx";

export function AdminLoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user?.isSuperAdmin || user?.role === "superadmin") {
    return <Navigate to="/admin/users" replace />;
  }

  /**
   * @param {React.FormEvent} e
   */
  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await login({ email, password });
      if (data.user?.isSuperAdmin || data.user?.role === "superadmin") {
        navigate("/admin/users", { replace: true });
        return;
      }
      setError({
        title: "Not a platform administrator",
        detail: "This account does not have super-admin access.",
        hint: "Use the regular sign-in for tenant accounts, or ask the platform owner to add your email to SUPERADMIN_EMAILS.",
      });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-3 py-8 sm:px-4 sm:py-10 md:px-0">
      <div className="rounded-2xl border border-violet-200 bg-violet-50/60 px-4 py-3">
        <h1 className="text-xl font-bold tracking-tight text-violet-950 sm:text-2xl">
          Platform admin
        </h1>
        <p className="mt-1 text-sm text-violet-900/80">
          Super-admin sign-in for SaaS operators — view all registered tenants and usage.
        </p>
      </div>

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}

      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-3 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm"
      >
        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="auth.email">Admin email</FieldLabel>
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
        <ButtonWithHelp helpId="admin.login">
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 rounded-xl bg-violet-800 px-4 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in as super-admin"}
          </button>
        </ButtonWithHelp>
      </form>

      <p className="text-sm text-teal-900/70">
        Tenant user?{" "}
        <Link className="font-semibold text-teal-700 underline" to="/login">
          Regular sign in
        </Link>
      </p>
    </div>
  );
}
