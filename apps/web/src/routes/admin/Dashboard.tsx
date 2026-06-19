import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  bucketByDay,
  downloadFile,
  fmtClock,
  fmtDateTime,
  fmtDuration,
  getSessionEvents,
  listSessions,
  sumCount,
  toCsv,
  totalDurationSec,
  type SessionRow,
  type TraceRow,
} from "../../lib/analytics";
import { listUsers, type UserRow } from "../../lib/userAdmin";
import { listAgents, type AgentWithId } from "../../lib/agents";

type RangeKey = "7d" | "30d" | "90d" | "all" | "custom";
const RANGES: { key: RangeKey; label: string; days: number }[] = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
  { key: "all", label: "All time", days: 0 },
  { key: "custom", label: "Custom", days: -1 },
];
const DAY = 86400000;

type SortKey = "date" | "duration";

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "danger" | "accent";
}) {
  return (
    <div className="rounded-lg border border-border bg-panel px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div
        className={
          "mt-1 text-2xl font-semibold " +
          (tone === "danger"
            ? "text-danger"
            : tone === "accent"
              ? "text-accent"
              : "text-white")
        }
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const nav = useNavigate();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [users, setUsers] = useState<Map<string, UserRow>>(new Map());
  const [agents, setAgents] = useState<AgentWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // filters
  const [range, setRange] = useState<RangeKey>("30d");
  const [customFrom, setCustomFrom] = useState(""); // YYYY-MM-DD
  const [customTo, setCustomTo] = useState("");
  const [agentIds, setAgentIds] = useState<string[]>([]); // empty = all
  const [userId, setUserId] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [chartMode, setChartMode] = useState<"sessions" | "minutes">("sessions");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // guided/transcript report (events fetched on demand for the filtered set)
  const [details, setDetails] = useState<{ s: SessionRow; events: TraceRow[] }[] | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsErr, setDetailsErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const [s, u, a] = await Promise.all([listSessions(2000), listUsers(), listAgents()]);
      setSessions(s);
      setUsers(new Map(u.map((x) => [x.uid, x])));
      setAgents(a);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const userLabel = (uid: string) => users.get(uid)?.userid || uid.slice(0, 8);

  const [rangeStart, rangeEnd] = useMemo<[number, number]>(() => {
    if (range === "custom") {
      const from = customFrom ? new Date(customFrom + "T00:00:00").getTime() : 0;
      const to = customTo ? new Date(customTo + "T23:59:59.999").getTime() : Date.now();
      return [from, to];
    }
    if (range === "all") return [0, Date.now()];
    const days = RANGES.find((r) => r.key === range)!.days;
    return [Date.now() - days * DAY, Date.now()];
  }, [range, customFrom, customTo]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const agentSet = new Set(agentIds);
    return sessions.filter((s) => {
      if (s.startedAt < rangeStart || s.startedAt > rangeEnd) return false;
      if (agentSet.size && !agentSet.has(s.agentId)) return false;
      if (userId && s.userId !== userId) return false;
      if (status && s.status !== status) return false;
      if (errorsOnly && !(s.counts?.errors)) return false;
      if (needle) {
        const hay = `${s.agentName} ${userLabel(s.userId)} ${
          users.get(s.userId)?.displayName || ""
        }`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, rangeStart, rangeEnd, agentIds, userId, status, errorsOnly, q, users]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = sortKey === "date" ? a.startedAt : a.durationSec || 0;
      const bv = sortKey === "date" ? b.startedAt : b.durationSec || 0;
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  // KPIs
  const trainees = useMemo(
    () => new Set(filtered.map((s) => s.userId)).size,
    [filtered]
  );
  const totalSec = totalDurationSec(filtered);
  const ended = filtered.filter((s) => s.durationSec && s.durationSec > 0);
  const avgSec = ended.length ? totalSec / ended.length : 0;

  // trend chart
  const chart = useMemo(() => {
    if (!filtered.length) return [];
    const from = range === "all" ? Math.min(...filtered.map((s) => s.startedAt)) : rangeStart;
    const to = range === "custom" ? rangeEnd : Date.now();
    const all = bucketByDay(filtered, from, to);
    return all.slice(-60); // cap bars
  }, [filtered, range, rangeStart, rangeEnd]);
  const chartMax = Math.max(
    1,
    ...chart.map((c) => (chartMode === "sessions" ? c.count : c.minutes))
  );

  const setSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  };

  const exportCsv = () => {
    const rows = sorted.map((s) => ({
      startedAt: new Date(s.startedAt).toISOString(),
      trainee: userLabel(s.userId),
      agent: s.agentName,
      durationSec: s.durationSec || 0,
      status: s.status,
      voice: s.voiceUsed || "",
      spoken: s.counts?.spoken || 0,
      typed: s.counts?.typed || 0,
      catalogClicks: s.counts?.catalogClicks || 0,
      toolCalls: s.counts?.toolCalls || 0,
      errors: s.counts?.errors || 0,
      endReason: s.endReason || "",
      sessionId: s.id,
    }));
    const csv = toCsv(rows, [
      { key: "startedAt", label: "Started (ISO)" },
      { key: "trainee", label: "Trainee" },
      { key: "agent", label: "Agent" },
      { key: "durationSec", label: "Duration (s)" },
      { key: "status", label: "Status" },
      { key: "voice", label: "Voice" },
      { key: "spoken", label: "Spoken" },
      { key: "typed", label: "Typed" },
      { key: "catalogClicks", label: "Guided clicks" },
      { key: "toolCalls", label: "Tool calls" },
      { key: "errors", label: "Errors" },
      { key: "endReason", label: "End reason" },
      { key: "sessionId", label: "Session ID" },
    ]);
    downloadFile(`avtp-sessions-${Date.now()}.csv`, csv, "text/csv");
  };
  const exportJson = () =>
    downloadFile(
      `avtp-sessions-${Date.now()}.json`,
      JSON.stringify(sorted, null, 2),
      "application/json"
    );

  const toggleAgent = (id: string) =>
    setAgentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // The report fetches per-session events; clear it whenever the filter changes
  // so we never show a stale report for a different filter.
  useEffect(() => {
    setDetails(null);
    setDetailsErr(null);
  }, [rangeStart, rangeEnd, agentIds, userId, status, errorsOnly, q]);

  const buildReport = async () => {
    setDetailsLoading(true);
    setDetailsErr(null);
    try {
      const out = await Promise.all(
        filtered.map(async (s) => ({ s, events: await getSessionEvents(s.id) }))
      );
      setDetails(out);
    } catch (e) {
      setDetailsErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailsLoading(false);
    }
  };

  // Guided-question breakdown over the fetched report.
  const guided = useMemo(() => {
    if (!details) return null;
    const map = new Map<string, { text: string; count: number; trainees: Set<string> }>();
    for (const { s, events } of details) {
      for (const e of events) {
        if (e.type !== "catalog_click") continue;
        const key = e.questionId || e.text || "?";
        const cur = map.get(key) || { text: e.text || key, count: 0, trainees: new Set<string>() };
        cur.count += 1;
        cur.trainees.add(s.userId);
        map.set(key, cur);
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [details]);

  const exportGuidedCsv = () => {
    if (!guided) return;
    const rows = guided.map((g) => ({ question: g.text, clicks: g.count, trainees: g.trainees.size }));
    const csv = toCsv(rows, [
      { key: "question", label: "Guided question" },
      { key: "clicks", label: "Clicks" },
      { key: "trainees", label: "Distinct trainees" },
    ]);
    downloadFile(`avtp-guided-report-${Date.now()}.csv`, csv, "text/csv");
  };

  const exportTranscriptsJson = () => {
    if (!details) return;
    downloadFile(
      `avtp-transcripts-${Date.now()}.json`,
      JSON.stringify(details.map(({ s, events }) => ({ session: s, events })), null, 2),
      "application/json"
    );
  };

  const exportTranscriptsTxt = () => {
    if (!details) return;
    const blocks = details
      .slice()
      .sort((a, b) => a.s.startedAt - b.s.startedAt)
      .map(({ s, events }) => {
        const head =
          `=== ${s.agentName} | ${userLabel(s.userId)} | ` +
          `${new Date(s.startedAt).toLocaleString()} | ${fmtDuration(s.durationSec)} ===`;
        const rel = (ts: number) => `[${fmtClock((ts - s.startedAt) / 1000)}]`;
        const lines = events.map((e) => {
          if (e.type === "user_msg") return `${rel(e.ts)} Trainee${e.via === "text" ? " (typed)" : ""}: ${e.text || ""}`;
          if (e.type === "assistant_msg") return `${rel(e.ts)} Agent: ${e.text || ""}`;
          if (e.type === "catalog_click") return `${rel(e.ts)} Trainee (guided): ${e.text || ""}`;
          if (e.type === "tool_call")
            return `${rel(e.ts)} · tool ${e.tool?.name || "?"}${e.tool?.query ? ` "${e.tool.query}"` : ""} → ${e.tool?.resultCount ?? "?"} results`;
          if (e.type === "error") return `${rel(e.ts)} · ERROR: ${e.text || ""}`;
          return `${rel(e.ts)} · ${e.type}`;
        });
        return head + "\n" + lines.join("\n");
      });
    downloadFile(`avtp-transcripts-${Date.now()}.txt`, blocks.join("\n\n"), "text/plain");
  };

  const guidedTotal = guided ? guided.reduce((n, g) => n + g.count, 0) : 0;

  const SortHead = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <button
      onClick={() => setSort(k)}
      className="inline-flex items-center gap-1 hover:text-white"
    >
      {children}
      {sortKey === k && <span className="text-accent">{sortDir === "asc" ? "▲" : "▼"}</span>}
    </button>
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Analytics</h2>
          <p className="text-sm text-muted">
            Every training session — transcripts, traces, tool calls and guided-question
            activity.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-panel"
          >
            Refresh
          </button>
          <button
            onClick={exportCsv}
            disabled={!sorted.length}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-panel disabled:opacity-40"
          >
            Export CSV
          </button>
          <button
            onClick={exportJson}
            disabled={!sorted.length}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-panel disabled:opacity-40"
          >
            Export JSON
          </button>
        </div>
      </div>

      {/* filters */}
      <div className="rounded-lg border border-border bg-panel p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-border overflow-hidden">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={
                  "px-3 py-1.5 text-sm " +
                  (range === r.key ? "bg-accent text-white" : "text-muted hover:bg-bg")
                }
              >
                {r.label}
              </button>
            ))}
          </div>
          {range === "custom" && (
            <div className="flex items-center gap-1.5 text-sm">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm"
              />
              <span className="text-muted">→</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm"
              />
            </div>
          )}
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm"
          >
            <option value="">All trainees</option>
            {[...users.values()]
              .sort((a, b) => a.userid.localeCompare(b.userid))
              .map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.userid}
                </option>
              ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm"
          >
            <option value="">Any status</option>
            <option value="ended">Ended</option>
            <option value="active">Active</option>
            <option value="aborted">Aborted</option>
          </select>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search trainee / agent…"
            className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm flex-1 min-w-[160px]"
          />
          <label className="flex items-center gap-1.5 text-sm text-muted px-1">
            <input
              type="checkbox"
              checked={errorsOnly}
              onChange={(e) => setErrorsOnly(e.target.checked)}
            />
            Errors only
          </label>
        </div>
        {/* agent multi-select (none selected = all) */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted mr-1">Agents:</span>
          <button
            onClick={() => setAgentIds([])}
            className={
              "rounded-full border px-2.5 py-1 text-xs " +
              (agentIds.length === 0
                ? "border-accent bg-accent/15 text-accent"
                : "border-border text-muted hover:bg-bg")
            }
          >
            All
          </button>
          {agents.map((a) => {
            const on = agentIds.includes(a.id);
            return (
              <button
                key={a.id}
                onClick={() => toggleAgent(a.id)}
                className={
                  "rounded-full border px-2.5 py-1 text-xs " +
                  (on
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-border text-muted hover:bg-bg")
                }
              >
                {a.name}
              </button>
            );
          })}
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-danger/40 bg-danger/10 text-danger px-3 py-2 text-sm">
          {err}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-3 gap-3">
        <Kpi label="Sessions" value={String(filtered.length)} />
        <Kpi label="Active trainees" value={String(trainees)} />
        <Kpi
          label="Training time"
          value={fmtDuration(totalSec)}
          sub={`${Math.round(totalSec / 60)} min total`}
        />
        <Kpi label="Avg session" value={fmtDuration(avgSec)} sub={`${ended.length} completed`} />
        <Kpi label="Spoken turns" value={String(sumCount(filtered, "spoken"))} tone="accent" />
        <Kpi label="Typed messages" value={String(sumCount(filtered, "typed"))} />
        <Kpi label="Tool calls" value={String(sumCount(filtered, "toolCalls"))} />
        <Kpi label="Guided clicks" value={String(sumCount(filtered, "catalogClicks"))} />
        <Kpi
          label="Errors"
          value={String(sumCount(filtered, "errors"))}
          tone={sumCount(filtered, "errors") > 0 ? "danger" : undefined}
        />
      </div>

      {/* trend */}
      <div className="rounded-lg border border-border bg-panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">
            {chartMode === "sessions" ? "Sessions" : "Minutes"} per day
          </h3>
          <div className="flex rounded-md border border-border overflow-hidden text-xs">
            <button
              onClick={() => setChartMode("sessions")}
              className={
                "px-2 py-1 " +
                (chartMode === "sessions" ? "bg-accent text-white" : "text-muted hover:bg-bg")
              }
            >
              Sessions
            </button>
            <button
              onClick={() => setChartMode("minutes")}
              className={
                "px-2 py-1 " +
                (chartMode === "minutes" ? "bg-accent text-white" : "text-muted hover:bg-bg")
              }
            >
              Minutes
            </button>
          </div>
        </div>
        {chart.length === 0 ? (
          <div className="h-28 grid place-items-center text-sm text-muted">No data in range</div>
        ) : (
          <div className="flex items-end gap-[3px] h-28">
            {chart.map((c, i) => {
              const v = chartMode === "sessions" ? c.count : c.minutes;
              const h = Math.max(2, Math.round((v / chartMax) * 100));
              const showLabel = i % Math.ceil(chart.length / 12) === 0;
              return (
                <div key={c.key} className="flex-1 flex flex-col items-center justify-end h-full">
                  <div
                    title={`${c.label}: ${v} ${chartMode === "sessions" ? "sessions" : "min"}`}
                    style={{ height: `${h}%` }}
                    className="w-full rounded-sm bg-accent/70 hover:bg-accent transition-colors min-h-[2px]"
                  />
                  <div className="mt-1 h-3 text-[9px] text-muted leading-none">
                    {showLabel ? c.label : ""}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border bg-panel text-sm text-muted">
          {sorted.length} session{sorted.length === 1 ? "" : "s"}
          {loading && " · loading…"}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted bg-panel/50">
              <tr className="text-left">
                <th className="px-4 py-2 font-medium">
                  <SortHead k="date">Date</SortHead>
                </th>
                <th className="px-4 py-2 font-medium">Trainee</th>
                <th className="px-4 py-2 font-medium">Agent</th>
                <th className="px-4 py-2 font-medium">
                  <SortHead k="duration">Duration</SortHead>
                </th>
                <th className="px-4 py-2 font-medium">Voice</th>
                <th className="px-4 py-2 font-medium text-right">Msgs</th>
                <th className="px-4 py-2 font-medium text-right">Tools</th>
                <th className="px-4 py-2 font-medium text-right">Clicks</th>
                <th className="px-4 py-2 font-medium text-right">Err</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => nav(`/dashboard/${s.id}`)}
                  className="border-t border-border hover:bg-panel cursor-pointer"
                >
                  <td className="px-4 py-2 whitespace-nowrap">{fmtDateTime(s.startedAt)}</td>
                  <td className="px-4 py-2">
                    <span title={users.get(s.userId)?.displayName || ""}>
                      {userLabel(s.userId)}
                    </span>
                  </td>
                  <td className="px-4 py-2">{s.agentName}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{fmtDuration(s.durationSec)}</td>
                  <td className="px-4 py-2 text-muted">{s.voiceUsed || "—"}</td>
                  <td className="px-4 py-2 text-right text-muted">
                    {(s.counts?.spoken || 0) + (s.counts?.typed || 0)}
                  </td>
                  <td className="px-4 py-2 text-right text-muted">{s.counts?.toolCalls || 0}</td>
                  <td className="px-4 py-2 text-right text-muted">
                    {s.counts?.catalogClicks || 0}
                  </td>
                  <td
                    className={
                      "px-4 py-2 text-right " +
                      (s.counts?.errors ? "text-danger" : "text-muted")
                    }
                  >
                    {s.counts?.errors || 0}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        "rounded-full px-2 py-0.5 text-[11px] " +
                        (s.status === "active"
                          ? "bg-accent/15 text-accent"
                          : s.status === "aborted"
                            ? "bg-danger/15 text-danger"
                            : "bg-border text-muted")
                      }
                    >
                      {s.status}
                    </span>
                  </td>
                </tr>
              ))}
              {!loading && sorted.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-muted">
                    No sessions match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* guided-question & transcript report (events fetched on demand) */}
      <div className="rounded-lg border border-border bg-panel p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-medium">Guided‑question &amp; transcript report</h3>
            <p className="text-xs text-muted">
              For the {filtered.length} filtered session{filtered.length === 1 ? "" : "s"}: which
              guided questions were used (and how often), plus a bulk transcript/trace export.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void buildReport()}
              disabled={!filtered.length || detailsLoading}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-panel disabled:opacity-40"
            >
              {detailsLoading ? "Building…" : details ? "Rebuild" : "Build report"}
            </button>
            {details && (
              <>
                <button
                  onClick={exportGuidedCsv}
                  className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-panel"
                >
                  Guided CSV
                </button>
                <button
                  onClick={exportTranscriptsTxt}
                  className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-panel"
                >
                  Transcripts .txt
                </button>
                <button
                  onClick={exportTranscriptsJson}
                  className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-panel"
                >
                  Transcripts JSON
                </button>
              </>
            )}
          </div>
        </div>

        {detailsErr && (
          <div className="rounded-md border border-danger/40 bg-danger/10 text-danger px-3 py-2 text-sm">
            {detailsErr}
          </div>
        )}

        {filtered.length > 200 && !details && (
          <div className="text-xs text-muted">
            Heads up: {filtered.length} sessions — building the report fetches each one's events and
            may take a few seconds.
          </div>
        )}

        {details && guided && (
          <>
            <div className="text-xs text-muted">
              {guidedTotal} guided click{guidedTotal === 1 ? "" : "s"} ·{" "}
              {guided.length} distinct question{guided.length === 1 ? "" : "s"} ·{" "}
              {fmtDuration(totalSec)} total time across {details.length} session
              {details.length === 1 ? "" : "s"}
            </div>
            {guided.length === 0 ? (
              <div className="text-sm text-muted py-4 text-center">
                No guided questions were used in this set.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted bg-panel/50">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium">Guided question</th>
                      <th className="px-3 py-2 font-medium text-right">Clicks</th>
                      <th className="px-3 py-2 font-medium text-right">Trainees</th>
                    </tr>
                  </thead>
                  <tbody>
                    {guided.map((g, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-2">{g.text}</td>
                        <td className="px-3 py-2 text-right text-muted">{g.count}</td>
                        <td className="px-3 py-2 text-right text-muted">{g.trainees.size}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
