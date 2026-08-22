/**
 * @fileoverview Register page for new YamBot accounts.
 */

import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { ButtonWithHelp, FieldLabel } from "../components/FieldLabel.jsx";

export function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
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
      await register({ name, email, password });
      navigate("/");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-3 py-8 sm:px-4 sm:py-10 md:px-0">
      <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Create your YamBot account</h1>
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
          <FieldLabel helpId="auth.name">Name</FieldLabel>
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="auth.email">Email</FieldLabel>
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <FieldLabel helpId="auth.password" required>
            Password (min 6)
          </FieldLabel>
          <input
            className="min-h-11 rounded-xl border border-teal-100 px-3"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
        </label>
        <ButtonWithHelp helpId="auth.register">
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create account"}
          </button>
        </ButtonWithHelp>
      </form>
      <p className="text-sm">
        Already have an account?{" "}
        <Link className="font-semibold text-teal-700 underline" to="/login">
          Sign in
        </Link>
      </p>
    </div>
  );
}
