import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { humanizeError } from "../lib/errors";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [userid, setUserid] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await login(userid.trim(), password);
      nav("/", { replace: true });
    } catch (e) {
      setErr(humanizeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full grid place-items-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-panel border border-border rounded-2xl p-7"
      >
        <h1 className="text-lg font-semibold">Astra Voice Training</h1>
        <p className="text-sm text-muted mt-1">Sign in to continue.</p>

        <label className="block mt-6 text-sm">
          <span className="text-muted">User ID</span>
          <input
            value={userid}
            onChange={(e) => setUserid(e.target.value)}
            autoComplete="username"
            autoFocus
            className="mt-1 w-full rounded-lg bg-bg border border-border px-3 py-2 outline-none focus:border-accent"
          />
        </label>

        <label className="block mt-4 text-sm">
          <span className="text-muted">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="mt-1 w-full rounded-lg bg-bg border border-border px-3 py-2 outline-none focus:border-accent"
          />
        </label>

        {err && <p className="mt-4 text-sm text-danger">{err}</p>}

        <button
          type="submit"
          disabled={busy || !userid || !password}
          className="mt-6 w-full rounded-lg bg-accent text-black font-semibold py-2.5 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
