import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { auth } from "../../firebase";
import { useAuth } from "../../auth/AuthContext";
import { getAgent, type AgentWithId } from "../../lib/agents";
import { resolveVisibleGuide, type GuideSection } from "../../lib/guidedQuestions";
import { startSession, logEvent, endSession, type SessionCounts } from "../../lib/sessions";
import {
  VoiceClient,
  type VoiceConfig,
  type TranscriptUpdate,
  type ToolUse,
} from "../../runtime/VoiceClient";
import { humanizeError } from "../../lib/errors";
import { evaluateStart, type StartEvaluation } from "../../lib/limits";
import { startLive, heartbeat, endLive, HEARTBEAT_MS } from "../../lib/liveSessions";
import { logError, type ErrorSource } from "../../lib/errorLog";

const PROXY_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8787";

function startError(e: unknown): string {
  const m = String((e as { message?: string })?.message || e || "");
  if (/failed to fetch|networkerror|err_connection|load failed/i.test(m))
    return `Couldn't reach the voice service. Make sure the proxy is running (the "server" folder → npm start, on ${PROXY_BASE}).`;
  if (/permission|notallowed|denied|dismissed/i.test(m))
    return "Microphone access was blocked. Allow the mic for this site and try again.";
  if (/\/session failed|401|403|500/.test(m))
    return `Voice service rejected the session (${m}). Check the proxy / xAI key.`;
  return `Couldn't start the session: ${m}`;
}

interface Msg {
  id: string;
  role: "user" | "assistant";
  text: string;
  interim: boolean;
}

export default function Train() {
  const { id } = useParams();
  const { user } = useAuth();

  const [agent, setAgent] = useState<AgentWithId | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [state, setState] = useState("idle");
  const [voice, setVoice] = useState<string>("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [tool, setTool] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [runErr, setRunErr] = useState<string | null>(null);
  const [guide, setGuide] = useState<GuideSection[] | null>(null);
  const [limitInfo, setLimitInfo] = useState<StartEvaluation | null>(null);
  const [endedNote, setEndedNote] = useState<string | null>(null);
  const [limitWarn, setLimitWarn] = useState<string | null>(null);
  const pendingRef = useRef<{ text: string; qid: string; sid: string } | null>(null);

  const clientRef = useRef<VoiceClient | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number>(0);
  const countsRef = useRef<SessionCounts>({ spoken: 0, typed: 0, catalogClicks: 0, toolCalls: 0, errors: 0 });
  const textByIdRef = useRef<Map<string, string>>(new Map());
  const loggedRef = useRef<Set<string>>(new Set());
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const capTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleMsRef = useRef<number>(0);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!id) return;
    getAgent(id)
      .then((a) => {
        if (!a) setLoadErr("Agent not found or not available to you.");
        else {
          setAgent(a);
          setVoice(a.voices.default);
        }
      })
      .catch((e) => setLoadErr(humanizeError(e)));
  }, [id]);

  useEffect(() => {
    if (!agent || !user) return;
    resolveVisibleGuide(agent.id, user.uid, user.role)
      .then(setGuide)
      .catch(() => setGuide([]));
  }, [agent, user]);

  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (clientRef.current && clientRef.current.state !== "idle") {
        clientRef.current.stop();
        void finalize("disconnect");
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Usage limits: load on mount so the trainee sees their allowance before starting.
  const refreshLimits = async () => {
    if (!user) return;
    try {
      setLimitInfo(await evaluateStart(user.uid));
    } catch {
      /* non-blocking */
    }
  };
  useEffect(() => {
    void refreshLimits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const clearTimers = () => {
    for (const r of [capTimerRef, warnTimerRef, idleTimerRef]) {
      if (r.current) {
        clearTimeout(r.current);
        r.current = null;
      }
    }
  };
  const bumpIdle = () => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (idleMsRef.current > 0)
      idleTimerRef.current = setTimeout(() => autoEnd("timeout"), idleMsRef.current);
  };
  const autoEnd = (reason: "limit" | "timeout") => {
    clearTimers();
    setLimitWarn(null);
    clientRef.current?.stop();
    void finalize(reason);
    setEndedNote(
      reason === "limit"
        ? "Session ended — your time limit for this session was reached."
        : "Session ended due to inactivity."
    );
    void refreshLimits();
  };

  const logErr = (source: ErrorSource, message: string, detail?: string) =>
    void logError({
      source,
      message,
      detail,
      userId: user?.uid,
      userid: user?.userid,
      agentId: agent?.id,
      agentName: agent?.name,
      sessionId: sessionIdRef.current || undefined,
    });

  const upsert = (t: TranscriptUpdate) => {
    bumpIdle(); // any transcript = activity → reset the idle timer
    setMessages((prev) => {
      const i = prev.findIndex((m) => m.id === t.id);
      if (i === -1) {
        // barge-in can finalize a segment that never produced text — skip it
        if (!t.text && !t.appendText) return prev;
        const text = t.text || "";
        return [...prev, { id: t.id, role: t.role, text, interim: !t.final }];
      }
      const copy = [...prev];
      const m = { ...copy[i] };
      if (typeof t.appendText === "string") m.text += t.appendText;
      else if (typeof t.text === "string" && t.text.length >= m.text.length) m.text = t.text;
      if (t.final) m.interim = false;
      copy[i] = m;
      return copy;
    });
    // keep latest text for logging (never let a shorter "final" truncate it)
    const cur = textByIdRef.current.get(t.id) || "";
    if (typeof t.appendText === "string") textByIdRef.current.set(t.id, cur + t.appendText);
    else if (typeof t.text === "string" && t.text.length >= cur.length) textByIdRef.current.set(t.id, t.text);
    if (t.final) logFinal(t.id, t.role);
  };

  const logFinal = (msgId: string, role: "user" | "assistant") => {
    if (loggedRef.current.has(msgId)) return;
    const text = textByIdRef.current.get(msgId) || "";
    if (!text.trim()) return;
    loggedRef.current.add(msgId);
    if (role === "user") countsRef.current.spoken++;
    if (sessionIdRef.current) {
      void logEvent(sessionIdRef.current, {
        type: role === "user" ? "user_msg" : "assistant_msg",
        role,
        text,
      });
    }
  };

  const onToolUse = (t: ToolUse) => {
    bumpIdle();
    if (t.status === "start") {
      countsRef.current.toolCalls++;
      setTool(
        t.name === "search_knowledge_base" || t.name === "collections_search"
          ? `Searching knowledge base${t.query ? `: “${t.query.slice(0, 50)}”` : "…"}`
          : t.name === "web_search"
            ? `Searching the web${t.query ? `: “${t.query.slice(0, 50)}”` : "…"}`
            : `Using ${t.name}…`
      );
    } else {
      setTimeout(() => setTool(null), 600);
      if (sessionIdRef.current) {
        // Full trace: query, args, retrieved chunks, result preview, latency.
        void logEvent(sessionIdRef.current, {
          type: "tool_call",
          tool: {
            name: t.name,
            status: t.status,
            query: t.query ?? null,
            args: t.args ?? null,
            resultCount: t.resultCount ?? null,
            results: t.results ?? null,
            resultPreview: t.resultPreview ?? null,
            latencyMs: t.latencyMs ?? null,
            httpStatus: t.httpStatus ?? null,
            error: t.error ?? null,
          },
        });
      }
      if (t.status === "error") {
        countsRef.current.errors++;
        logErr(
          t.name === "search_knowledge_base" || t.name === "collections_search" ? "search" : "tool",
          `${t.name} failed`,
          t.error || undefined
        );
      }
    }
  };

  const buildConfig = (): VoiceConfig => {
    const a = agent!;
    return {
      proxyBase: PROXY_BASE,
      getIdToken: () => auth.currentUser!.getIdToken(),
      model: a.model,
      instructions: a.systemPrompt,
      voice: voice || a.voices.default,
      kb: {
        enabled: a.knowledgeBase.enabled,
        provider: a.knowledgeBase.provider || "custom",
        collectionIds: a.knowledgeBase.collectionIds || [],
        retrievalMode: a.knowledgeBase.retrievalMode,
        maxNumResults: a.knowledgeBase.maxNumResults,
        limit: a.knowledgeBase.limit,
      },
      webSearch: a.webSearch?.enabled || false,
      tools: (a.tools || [])
        .filter((t) => t.enabled)
        .map((t) => ({
          name: t.name,
          description: t.description,
          enabled: t.enabled,
          parameters: t.parameters as Record<string, unknown>,
          binding: { url: t.binding.url, method: t.binding.method },
        })),
    };
  };

  const doAsk = (text: string, qid: string, sid: string) => {
    if (!clientRef.current?.sendText(text)) return;
    const mid = `u-guided-${Date.now()}`;
    textByIdRef.current.set(mid, text);
    setMessages((p) => [...p, { id: mid, role: "user", text, interim: false }]);
    countsRef.current.catalogClicks++;
    if (sessionIdRef.current)
      void logEvent(sessionIdRef.current, {
        type: "catalog_click",
        role: "user",
        text,
        questionId: qid,
        sectionId: sid,
      });
  };
  const flushPending = () => {
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    doAsk(p.text, p.qid, p.sid);
  };
  const onState = (s: string) => {
    setState(s);
    if (s === "live") flushPending();
  };

  const start = async () => {
    if (!agent || !user) return;
    setRunErr(null);
    setEndedNote(null);
    setLimitWarn(null);

    // Enforce usage limits before starting (concurrent / quota).
    let ev: StartEvaluation;
    try {
      ev = await evaluateStart(user.uid);
      setLimitInfo(ev);
    } catch (e) {
      setRunErr(humanizeError(e));
      pendingRef.current = null;
      return;
    }
    if (!ev.ok) {
      setRunErr(ev.reason || "You can't start a session right now.");
      pendingRef.current = null;
      return;
    }

    const client = new VoiceClient({
      onStateChange: onState,
      onTranscript: upsert,
      onToolUse,
      onError: (e) => {
        console.error(e);
        countsRef.current.errors++;
        setRunErr(startError(e));
        const er = e as { message?: string; error?: { message?: string } };
        const msg =
          er?.message ||
          er?.error?.message ||
          (typeof e === "string" ? e : (() => { try { return JSON.stringify(e); } catch { return String(e); } })());
        logErr("voice", msg);
      },
    });
    client.voice = voice;
    clientRef.current = client;
    countsRef.current = { spoken: 0, typed: 0, catalogClicks: 0, toolCalls: 0, errors: 0 };
    textByIdRef.current.clear();
    loggedRef.current.clear();
    setMessages([]);
    startedAtRef.current = Date.now();
    try {
      sessionIdRef.current = await startSession({
        userId: user.uid,
        agentId: agent.id,
        agentName: agent.name,
        voice: voice || agent.voices.default,
      });
    } catch (e) {
      console.error("session start log failed", e);
    }

    // Register a live-presence heartbeat (powers platform-wide concurrency).
    const sid = sessionIdRef.current;
    if (sid) {
      void startLive(sid, { userId: user.uid, agentId: agent.id, agentName: agent.name });
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => {
        if (sessionIdRef.current) void heartbeat(sessionIdRef.current, user.uid);
      }, HEARTBEAT_MS);
    }

    // Arm session-cap + idle timers from the resolved limits.
    clearTimers();
    idleMsRef.current = (ev.limits.idleTimeoutSec || 0) * 1000;
    bumpIdle();
    if (ev.sessionCapMin > 0) {
      const capMs = ev.sessionCapMin * 60000;
      capTimerRef.current = setTimeout(() => autoEnd("limit"), capMs);
      if (capMs > 75000)
        warnTimerRef.current = setTimeout(
          () => setLimitWarn("Heads up — this session will end in about a minute (time limit)."),
          capMs - 60000
        );
    }

    await client.start(buildConfig());
  };

  const askQuestion = (text: string, qid: string, sid: string) => {
    if (state === "live") {
      doAsk(text, qid, sid);
    } else {
      pendingRef.current = { text, qid, sid };
      if (state === "idle") void start();
    }
  };

  const finalize = async (endReason: string) => {
    clearTimers();
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    const sid = sessionIdRef.current;
    sessionIdRef.current = null;
    if (sid) void endLive(sid);
    if (!sid) return;
    const durationSec = Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000));
    try {
      await endSession(sid, { durationSec, counts: countsRef.current, endReason });
    } catch (e) {
      console.error("session end log failed", e);
    }
  };

  const stop = async () => {
    clientRef.current?.stop();
    await finalize("user");
    void refreshLimits();
  };

  const onVoiceChange = (v: string) => {
    setVoice(v);
    clientRef.current?.setVoice(v);
  };

  const sendTyped = () => {
    const text = typed.trim();
    if (!text) return;
    if (!clientRef.current?.sendText(text)) return;
    const mid = `u-typed-${Date.now()}`;
    textByIdRef.current.set(mid, text);
    setMessages((p) => [...p, { id: mid, role: "user", text, interim: false }]);
    countsRef.current.typed++;
    if (sessionIdRef.current) void logEvent(sessionIdRef.current, { type: "user_msg", role: "user", text, via: "text" });
    setTyped("");
  };

  if (loadErr) return <div className="max-w-3xl mx-auto px-6 py-8 text-danger">{loadErr} <Link className="text-accent" to="/my-agents">Back</Link></div>;
  if (!agent) return <div className="max-w-3xl mx-auto px-6 py-8 text-muted">Loading…</div>;

  const live = state === "live";
  const connecting = state === "connecting";

  const li = limitInfo;
  const capLabel = li && li.sessionCapMin > 0 ? `up to ${li.sessionCapMin} min` : null;
  let remainLabel: string | null = null;
  if (li) {
    if (li.limits.perDayMin > 0)
      remainLabel = `${Math.max(0, Math.floor(li.limits.perDayMin - li.usedDayMin))} min left today`;
    else if (li.limits.perWeekMin > 0)
      remainLabel = `${Math.max(0, Math.floor(li.limits.perWeekMin - li.usedWeekMin))} min left this week`;
    else if (li.limits.perMonthMin > 0)
      remainLabel = `${Math.max(0, Math.floor(li.limits.perMonthMin - li.usedMonthMin))} min left this month`;
  }
  const limitLine = [capLabel, remainLabel].filter(Boolean).join(" · ");

  return (
    <div className="flex h-[calc(100vh-57px)]">
      <GuidedSidebar guide={guide} disabled={connecting} onAsk={askQuestion} />
      <div className="flex-1 min-w-0 max-w-3xl mx-auto px-6 py-6 flex flex-col">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link to="/my-agents" className="text-muted text-sm">←</Link>
          <h2 className="text-base font-semibold">{agent.name}</h2>
          <span className="flex items-center gap-1.5 text-xs text-muted ml-2">
            <span className={"w-2 h-2 rounded-full " + (live ? "bg-accent" : connecting ? "bg-yellow-500" : "bg-muted")} />
            {live ? "Listening" : connecting ? "Connecting…" : "Idle"}
          </span>
          {limitLine && (
            <span className="text-xs text-muted ml-1 hidden sm:inline">· {limitLine}</span>
          )}
        </div>
        <label className="text-xs text-muted flex items-center gap-2">
          Voice
          <select
            className="bg-panel border border-border rounded-md px-2 py-1 text-text"
            value={voice}
            onChange={(e) => onVoiceChange(e.target.value)}
          >
            {(agent.voices.allowed || [agent.voices.default]).map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex-1 overflow-y-auto mt-4 space-y-3 pr-1">
        {messages.length === 0 && (
          <div className="text-muted text-sm text-center mt-10">
            Press <strong>Start</strong> and speak — or type below. The coach replies in voice.
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              "max-w-[75%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap " +
              (m.role === "user"
                ? "ml-auto bg-userbubble text-white rounded-br-sm"
                : "mr-auto bg-panel border border-border rounded-bl-sm") +
              (m.interim ? " opacity-60" : "")
            }
          >
            <div className="text-[10px] uppercase tracking-wide opacity-60 mb-0.5">
              {m.role === "user" ? "You" : "Coach"}
            </div>
            {m.text}
          </div>
        ))}
        <div ref={transcriptEndRef} />
      </div>

      {tool && (
        <div className="mx-auto mb-2 inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs text-accent">
          <span className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          {tool}
        </div>
      )}

      {limitWarn && (
        <div className="mb-2 rounded-lg border border-yellow-600/40 bg-yellow-600/10 px-3 py-2 text-xs text-yellow-500">
          {limitWarn}
        </div>
      )}

      {endedNote && (
        <div className="mb-2 rounded-lg border border-border bg-panel px-3 py-2 text-xs text-muted">
          {endedNote}
        </div>
      )}

      {runErr && (
        <div className="mb-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {runErr}
        </div>
      )}

      <div className="mt-2 flex gap-2">
        <input
          className="flex-1 bg-panel border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent disabled:opacity-50"
          placeholder={live ? "Type a message — the coach replies in voice…" : "Start the session to chat or speak…"}
          value={typed}
          disabled={!live}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendTyped();
            }
          }}
        />
        <button
          onClick={() => (live ? stop() : start())}
          disabled={connecting}
          className={
            "rounded-lg px-6 py-2.5 text-sm font-semibold text-white " +
            (live ? "bg-danger" : connecting ? "bg-yellow-700 cursor-wait" : "bg-accent !text-black")
          }
        >
          {live ? "End" : connecting ? "Connecting…" : "Start"}
        </button>
      </div>
      </div>
    </div>
  );
}

function GuidedSidebar({
  guide,
  disabled,
  onAsk,
}: {
  guide: GuideSection[] | null;
  disabled: boolean;
  onAsk: (text: string, qid: string, sid: string) => void;
}) {
  return (
    <aside className="w-72 shrink-0 border-r border-border overflow-y-auto p-3 hidden md:block">
      <div className="text-[11px] uppercase tracking-wide text-muted px-1 mb-2">
        Guided questions
      </div>
      {guide === null && <div className="text-xs text-muted px-1">Loading…</div>}
      {guide?.length === 0 && (
        <div className="text-xs text-muted px-1">
          No guided questions for this agent yet.
        </div>
      )}
      {guide?.map((sec) => (
        <details key={sec.id} open className="mb-2">
          <summary className="cursor-pointer text-sm font-medium py-1 px-1">{sec.title}</summary>
          <div className="mt-1 space-y-1">
            {sec.looseQuestions.map((q) => (
              <QBtn key={q.id} text={q.text} disabled={disabled} onClick={() => onAsk(q.text, q.id, sec.id)} />
            ))}
            {sec.subsections
              .filter((ss) => ss.questions.length)
              .map((ss) => (
                <details key={ss.id} open className="pl-1">
                  <summary className="cursor-pointer text-xs text-muted py-0.5">{ss.title}</summary>
                  <div className="mt-1 space-y-1 pl-1">
                    {ss.questions.map((q) => (
                      <QBtn key={q.id} text={q.text} disabled={disabled} onClick={() => onAsk(q.text, q.id, sec.id)} />
                    ))}
                  </div>
                </details>
              ))}
          </div>
        </details>
      ))}
    </aside>
  );
}

function QBtn({ text, disabled, onClick }: { text: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="w-full text-left text-xs rounded-md px-2 py-1.5 bg-bg border border-border hover:border-accent hover:text-white disabled:opacity-50 leading-snug"
    >
      {text}
    </button>
  );
}
