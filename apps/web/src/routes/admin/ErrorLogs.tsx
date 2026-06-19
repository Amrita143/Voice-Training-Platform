import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listErrorLogs, type ErrorCode, type ErrorLogRow } from "../../lib/errorLog";

const CODE_STYLE: Record<ErrorCode, string> = {
  rate_limit: "bg-yellow-600/15 text-yellow-500 border-yellow-600/40",
  auth: "bg-danger/15 text-danger border-danger/40",
  network: "bg-border text-muted border-border",
  error: "bg-danger/15 text-danger border-danger/40",
};

export default function ErrorLogs() {
  const [rows, setRows] = useState<ErrorLogRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [codeFilter, setCodeFilter] = useState<ErrorCode | "">("");

  const load = async () => {
    setErr(null);
    try {
      setRows(await listErrorLogs(300));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(
    () => (rows || []).filter((r) => !codeFilter || r.code === codeFilter),
    [rows, codeFilter]
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (rows || []).forEach((r) => (c[r.code] = (c[r.code] || 0) + 1));
    return c;
  }, [rows]);

  const codes: (ErrorCode | "")[] = ["", "rate_limit", "auth", "network", "error"];

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold">Error logs</h2>
          <p className="text-sm text-muted mt-1">
            Voice/session failures captured from trainees' sessions — rate limits, network, auth
            and tool errors.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-panel"
        >
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {codes.map((c) => (
          <button
            key={c || "all"}
            onClick={() => setCodeFilter(c)}
            className={
              "rounded-full border px-2.5 py-1 text-xs " +
              (codeFilter === c
                ? "border-accent bg-accent/15 text-accent"
                : "border-border text-muted hover:bg-bg")
            }
          >
            {c === "" ? `All (${rows?.length || 0})` : `${c.replace("_", " ")} (${counts[c] || 0})`}
          </button>
        ))}
      </div>

      {err && (
        <div className="rounded-md border border-danger/40 bg-danger/10 text-danger px-3 py-2 text-sm">
          {err}
        </div>
      )}

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-panel text-muted text-xs uppercase tracking-wide">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Trainee</th>
                <th className="px-3 py-2 font-medium">Agent</th>
                <th className="px-3 py-2 font-medium">Message</th>
                <th className="px-3 py-2 font-medium">Session</th>
              </tr>
            </thead>
            <tbody>
              {rows === null && (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {rows && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-muted">
                    No errors logged. 🎉
                  </td>
                </tr>
              )}
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="px-3 py-2 whitespace-nowrap text-muted">
                    {new Date(r.ts).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={"rounded-full border px-2 py-0.5 text-[11px] " + CODE_STYLE[r.code]}
                    >
                      {r.code.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted">{r.source}</td>
                  <td className="px-3 py-2">{r.userid || r.userId?.slice(0, 8) || "—"}</td>
                  <td className="px-3 py-2">{r.agentName || "—"}</td>
                  <td className="px-3 py-2 max-w-md">
                    <div className="break-words">{r.message}</div>
                    {r.detail && (
                      <div className="text-[11px] text-muted break-words mt-0.5">{r.detail}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.sessionId ? (
                      <Link to={`/dashboard/${r.sessionId}`} className="text-accent hover:underline text-xs">
                        open
                      </Link>
                    ) : (
                      <span className="text-muted text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
