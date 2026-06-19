import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { getMyAgents } from "../../lib/myAgents";
import type { AgentWithId } from "../../lib/agents";
import { humanizeError } from "../../lib/errors";

export default function MyAgents() {
  const { user } = useAuth();
  const [rows, setRows] = useState<AgentWithId[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    getMyAgents(user.uid, user.role)
      .then(setRows)
      .catch((e) => setErr(humanizeError(e)));
  }, [user]);

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <h2 className="text-xl font-semibold">Train</h2>
      <p className="text-sm text-muted mt-1">
        Pick a voice agent to start a training session.
      </p>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {rows === null && <div className="text-muted text-sm">Loading…</div>}
        {rows?.length === 0 && (
          <div className="text-muted text-sm">
            No agents assigned to you yet — ask your admin.
          </div>
        )}
        {rows?.map((a) => (
          <Link
            key={a.id}
            to={`/train/${a.id}`}
            className="rounded-xl border border-border bg-panel p-4 hover:border-accent transition-colors"
          >
            <div className="font-medium">{a.name}</div>
            <div className="text-xs text-muted mt-1">
              {a.description || "Voice trainer"}
            </div>
            <div className="text-xs text-accent mt-3">Start training →</div>
          </Link>
        ))}
      </div>
      {err && <p className="mt-3 text-sm text-danger">{err}</p>}
    </div>
  );
}
