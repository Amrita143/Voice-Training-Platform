import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { humanizeError } from "../lib/errors";

export default function ChangePassword() {
  const { user, changePassword } = useAuth();
  const nav = useNavigate();
  const forced = !!user?.mustChangePassword;
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (newPassword.length < 8) return setErr("Password must be at least 8 characters.");
    if (newPassword !== confirm) return setErr("Passwords do not match.");
    setBusy(true);
    try {
      await changePassword(newPassword);
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
        <h1 className="text-lg font-semibold">
          {forced ? "Set a new password" : "Change password"}
        </h1>
        {forced && (
          <p className="text-sm text-muted mt-1">
            You must set a new password before continuing.
          </p>
        )}

        <label className="block mt-6 text-sm">
          <span className="text-muted">New password</span>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            className="mt-1 w-full rounded-lg bg-bg border border-border px-3 py-2 outline-none focus:border-accent"
          />
        </label>
        <label className="block mt-4 text-sm">
          <span className="text-muted">Confirm new password</span>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            className="mt-1 w-full rounded-lg bg-bg border border-border px-3 py-2 outline-none focus:border-accent"
          />
        </label>

        {err && <p className="mt-4 text-sm text-danger">{err}</p>}

        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full rounded-lg bg-accent text-black font-semibold py-2.5 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save password"}
        </button>
      </form>
    </div>
  );
}
