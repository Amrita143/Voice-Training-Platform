import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebase";
import {
  downloadFile,
  fmtClock,
  fmtDateTime,
  fmtDuration,
  getSession,
  getSessionEvents,
  type SessionRow,
  type TraceRow,
} from "../../lib/analytics";

function jsonStr(v: unknown): string {
  try {
    return typeof v === "string" ? v : JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function Chip({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="rounded-md border border-border bg-panel px-3 py-1.5">
      <span className="text-[11px] uppercase tracking-wide text-muted">{label}</span>{" "}
      <span className={"text-sm " + (tone === "danger" ? "text-danger" : "text-white")}>
        {value}
      </span>
    </div>
  );
}

export default function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<SessionRow | null>(null);
  const [events, setEvents] = useState<TraceRow[]>([]);
  const [trainee, setTrainee] = useState<{ userid: string; displayName: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [openTools, setOpenTools] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const [s, ev] = await Promise.all([getSession(id), getSessionEvents(id)]);
        setSession(s);
        setEvents(ev);
        if (s?.userId) {
          const u = await getDoc(doc(db, "users", s.userId));
          if (u.exists()) {
            const d = u.data() as { userid?: string; displayName?: string };
            setTrainee({ userid: d.userid || s.userId, displayName: d.displayName || "" });
          }
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const rel = (ts: number) => (session ? fmtClock((ts - session.startedAt) / 1000) : "");

  const toolIds = events.filter((e) => e.type === "tool_call").map((e) => e.id);
  const allToolsOpen = toolIds.length > 0 && toolIds.every((id) => openTools.has(id));
  const toggleTool = (id: string) =>
    setOpenTools((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAllTools = () => setOpenTools(allToolsOpen ? new Set() : new Set(toolIds));

  const exportTxt = () => {
    if (!session) return;
    const head = [
      `Session ${session.id}`,
      `Agent: ${session.agentName}`,
      `Trainee: ${trainee?.userid || session.userId}`,
      `Started: ${new Date(session.startedAt).toISOString()}`,
      `Duration: ${fmtDuration(session.durationSec)}`,
      `Voice: ${session.voiceUsed || "—"}  Status: ${session.status}`,
      "".padEnd(48, "-"),
    ].join("\n");
    const body = events
      .map((e) => {
        const t = `[${rel(e.ts)}]`;
        if (e.type === "user_msg")
          return `${t} Trainee${e.via === "text" ? " (typed)" : ""}: ${e.text || ""}`;
        if (e.type === "assistant_msg") return `${t} Agent: ${e.text || ""}`;
        if (e.type === "catalog_click") return `${t} Trainee (guided): ${e.text || ""}`;
        if (e.type === "tool_call")
          return `${t} · tool ${e.tool?.name || "?"}${
            e.tool?.query ? ` "${e.tool.query}"` : ""
          } → ${e.tool?.resultCount ?? "?"} results (${e.tool?.status || "?"})`;
        if (e.type === "error") return `${t} · ERROR: ${e.text || ""}`;
        return `${t} · ${e.type}: ${e.text || ""}`;
      })
      .join("\n");
    downloadFile(`avtp-session-${session.id}.txt`, head + "\n" + body, "text/plain");
  };
  const exportJson = () => {
    if (!session) return;
    downloadFile(
      `avtp-session-${session.id}.json`,
      JSON.stringify({ session, events }, null, 2),
      "application/json"
    );
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link to="/dashboard" className="text-sm text-accent hover:underline">
          ← Back to analytics
        </Link>
        {session && (
          <div className="flex items-center gap-2">
            <button
              onClick={exportTxt}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-panel"
            >
              Export transcript
            </button>
            <button
              onClick={exportJson}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-panel"
            >
              Export JSON
            </button>
          </div>
        )}
      </div>

      {loading && <div className="text-sm text-muted">Loading…</div>}
      {err && (
        <div className="rounded-md border border-danger/40 bg-danger/10 text-danger px-3 py-2 text-sm">
          {err}
        </div>
      )}
      {!loading && !session && !err && (
        <div className="text-sm text-muted">Session not found.</div>
      )}

      {session && (
        <>
          <div>
            <h2 className="text-lg font-semibold">{session.agentName}</h2>
            <p className="text-sm text-muted">
              {trainee?.userid || session.userId}
              {trainee?.displayName ? ` · ${trainee.displayName}` : ""} ·{" "}
              {fmtDateTime(session.startedAt)}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Chip label="Duration" value={fmtDuration(session.durationSec)} />
            <Chip label="Status" value={session.status} />
            <Chip label="Voice" value={session.voiceUsed || "—"} />
            <Chip label="Spoken" value={String(session.counts?.spoken ?? 0)} />
            <Chip label="Typed" value={String(session.counts?.typed ?? 0)} />
            <Chip label="Guided" value={String(session.counts?.catalogClicks ?? 0)} />
            <Chip label="Tools" value={String(session.counts?.toolCalls ?? 0)} />
            <Chip
              label="Errors"
              value={String(session.counts?.errors ?? 0)}
              tone={session.counts?.errors ? "danger" : undefined}
            />
            {session.endReason && <Chip label="Ended by" value={session.endReason} />}
          </div>

          <div className="rounded-lg border border-border bg-panel/40 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium">Transcript &amp; trace</h3>
              {toolIds.length > 0 && (
                <button
                  onClick={toggleAllTools}
                  className="text-xs text-accent hover:underline"
                >
                  {allToolsOpen
                    ? "Collapse all tool calls"
                    : `Expand all tool calls (${toolIds.length})`}
                </button>
              )}
            </div>
            {events.length === 0 ? (
              <div className="text-sm text-muted py-6 text-center">
                No events were recorded for this session.
              </div>
            ) : (
              <div className="space-y-3">
                {events.map((e) => {
                  const isUser = e.type === "user_msg" || e.type === "catalog_click";
                  const isAssistant = e.type === "assistant_msg";
                  if (isUser || isAssistant) {
                    return (
                      <div
                        key={e.id}
                        className={"flex " + (isUser ? "justify-end" : "justify-start")}
                      >
                        <div className="max-w-[78%]">
                          <div
                            className={
                              "text-[10px] text-muted mb-0.5 " +
                              (isUser ? "text-right" : "text-left")
                            }
                          >
                            {isUser
                              ? e.type === "catalog_click"
                                ? "Trainee · guided"
                                : `Trainee${e.via === "text" ? " · typed" : " · spoken"}`
                              : "Agent"}{" "}
                            · {rel(e.ts)}
                          </div>
                          <div
                            className={
                              "rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap " +
                              (isUser
                                ? "bg-userbubble text-white rounded-br-sm"
                                : "bg-panel border border-border rounded-bl-sm")
                            }
                          >
                            {e.text}
                          </div>
                        </div>
                      </div>
                    );
                  }
                  // tool call — expandable full detail (query, args, chunks, result)
                  if (e.type === "tool_call") {
                    const tl = e.tool || {};
                    const isErr = tl.status === "error";
                    const expanded = openTools.has(e.id);
                    const chunks = tl.results || [];
                    return (
                      <div key={e.id} className="space-y-1.5">
                        <div className="flex justify-center">
                          <button
                            onClick={() => toggleTool(e.id)}
                            className={
                              "text-[11px] rounded-full px-3 py-1 border inline-flex items-center gap-1 max-w-full " +
                              (isErr
                                ? "border-danger/40 bg-danger/10 text-danger"
                                : "border-border bg-panel text-muted hover:text-white")
                            }
                          >
                            <span>{expanded ? "▾" : "▸"}</span>
                            <span className="truncate">
                              🔧 <span className="text-white/80">{tl.name}</span>
                              {tl.query ? ` · "${tl.query}"` : ""}
                              {tl.resultCount != null ? ` · ${tl.resultCount} results` : ""}
                              {tl.latencyMs != null ? ` · ${tl.latencyMs}ms` : ""}
                              {tl.status ? ` · ${tl.status}` : ""} · {rel(e.ts)}
                            </span>
                          </button>
                        </div>
                        {expanded && (
                          <div className="rounded-lg border border-border bg-bg/60 p-3 text-xs space-y-2">
                            {tl.query && (
                              <div>
                                <span className="text-muted">Query: </span>
                                {tl.query}
                              </div>
                            )}
                            {tl.args != null && (
                              <div>
                                <div className="text-muted mb-0.5">Arguments</div>
                                <pre className="whitespace-pre-wrap break-words bg-panel border border-border rounded p-2 overflow-x-auto">
                                  {jsonStr(tl.args)}
                                </pre>
                              </div>
                            )}
                            {tl.error && <div className="text-danger">⚠ {tl.error}</div>}
                            {chunks.length > 0 && (
                              <div>
                                <div className="text-muted mb-1">
                                  Retrieved chunks ({chunks.length})
                                </div>
                                <div className="space-y-2">
                                  {chunks.map((c, idx) => (
                                    <div
                                      key={idx}
                                      className="rounded border border-border bg-panel p-2"
                                    >
                                      <div className="text-[10px] text-muted mb-1">
                                        #{idx + 1}
                                        {typeof c.score === "number"
                                          ? ` · score ${c.score.toFixed(3)}`
                                          : ""}
                                        {c.fileId ? ` · ${c.fileId}` : ""}
                                      </div>
                                      <div className="whitespace-pre-wrap break-words">
                                        {c.content}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {tl.resultPreview && chunks.length === 0 && (
                              <div>
                                <div className="text-muted mb-0.5">Result</div>
                                <pre className="whitespace-pre-wrap break-words bg-panel border border-border rounded p-2 overflow-x-auto">
                                  {tl.resultPreview}
                                </pre>
                              </div>
                            )}
                            {tl.httpStatus != null && (
                              <div className="text-muted">HTTP {tl.httpStatus}</div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  }
                  // error / system meta rows (centered pill)
                  return (
                    <div key={e.id} className="flex justify-center">
                      <div
                        className={
                          "text-[11px] rounded-full px-3 py-1 border " +
                          (e.type === "error"
                            ? "border-danger/40 bg-danger/10 text-danger"
                            : "border-border bg-panel text-muted")
                        }
                      >
                        {e.type === "error" ? "⚠ " : ""}
                        {e.text || e.type} · {rel(e.ts)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
