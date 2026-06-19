// Browser controller for the xAI Grok Voice Agent, adapted for AVTP:
//  - fetches the ephemeral token from the xAI proxy (Authorization: Firebase ID token)
//  - applies a per-agent session config (prompt, voice, tools)
//  - handles search_knowledge_base (-> proxy /search) and custom tools (-> proxy /tool)
// Ported from the prototype voice-client.js.

const SAMPLE_RATE = 24000;

export interface KbConfig {
  enabled: boolean;
  provider?: "custom" | "xai_file_search";
  collectionIds: string[];
  retrievalMode: string;
  maxNumResults: number;
  limit: number;
}
export interface RuntimeTool {
  name: string;
  description: string;
  enabled: boolean;
  parameters: Record<string, unknown>;
  binding: { url: string; method: string };
}
export interface VoiceConfig {
  proxyBase: string;
  getIdToken: () => Promise<string>;
  model: string;
  instructions: string;
  voice: string;
  kb: KbConfig;
  webSearch: boolean;
  tools: RuntimeTool[];
}

export type TranscriptUpdate = {
  id: string;
  role: "user" | "assistant";
  text?: string;
  appendText?: string;
  final?: boolean;
};
export type ToolChunk = { content: string; score?: number; fileId?: string };
export type ToolUse = {
  name: string;
  status: "start" | "done" | "error";
  query?: string;
  resultCount?: number;
  args?: unknown;
  results?: ToolChunk[];
  resultPreview?: string;
  latencyMs?: number;
  httpStatus?: number;
  error?: string;
};

interface Callbacks {
  onStateChange?: (s: string) => void;
  onTranscript?: (t: TranscriptUpdate) => void;
  onToolUse?: (t: ToolUse) => void;
  onError?: (e: unknown) => void;
}

type RunState = "idle" | "connecting" | "live" | "stopping";

export class VoiceClient {
  onStateChange: (s: string) => void;
  onTranscript: (t: TranscriptUpdate) => void;
  onToolUse: (t: ToolUse) => void;
  onError: (e: unknown) => void;

  state: RunState = "idle";
  voice: string | null = null;

  private cfg: VoiceConfig | null = null;
  private ws: WebSocket | null = null;
  private micStream: MediaStream | null = null;
  private inputCtx: AudioContext | null = null;
  private outputCtx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  // Playback: a simple chunk queue played one-at-a-time, so an interrupt can
  // truly drop everything still pending (matches xAI's reference client).
  private _playQueue: Float32Array[] = [];
  private _playing = false;
  private _currentSource: AudioBufferSourceNode | null = null;
  private _activeAssistantId: string | null = null;
  private _wsIds: Set<string> = new Set(); // web_search items already counted
  private _suppressAudio = false; // drop audio from a response the user barged in on
  private _activeResponses = 0; // in-flight responses (for safe cancel on text inject)
  // User-turn consolidation: gather all user transcription items since the last
  // response into ONE logged turn (handles VAD splitting one question into parts
  // and overlap fragments), keyed by item_id so each source is de-duped.
  private _turnItems: Map<string, string> = new Map();
  private _turnOrder: string[] = [];
  private _userTurnSeq = 0;
  private _userTurnId = "u-turn-0";

  constructor(cb: Callbacks = {}) {
    this.onStateChange = cb.onStateChange || (() => {});
    this.onTranscript = cb.onTranscript || (() => {});
    this.onToolUse = cb.onToolUse || (() => {});
    this.onError = cb.onError || ((e) => console.error(e));
  }

  private setState(s: RunState) {
    this.state = s;
    this.onStateChange(s);
  }

  async start(cfg: VoiceConfig) {
    if (this.state !== "idle") return;
    this.cfg = cfg;
    this.voice = this.voice || cfg.voice;
    this.setState("connecting");
    try {
      const micPromise = navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const idToken = await cfg.getIdToken();
      const tokenPromise = fetch(`${cfg.proxyBase}/session`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
      }).then((r) => {
        if (!r.ok) throw new Error(`/session failed: ${r.status}`);
        return r.json();
      });
      const [micStream, sessionData] = await Promise.all([micPromise, tokenPromise]);
      this.micStream = micStream;

      const ephemeral =
        sessionData.token?.value ||
        sessionData.token?.client_secret?.value ||
        sessionData.token?.secret ||
        sessionData.token;

      this.outputCtx = new AudioContext({ sampleRate: SAMPLE_RATE });

      const url = `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(cfg.model)}`;
      // OpenAI-compatible handshake (xAI reference). Enables reliable server_vad
      // barge-in (the server interrupts the running response on user speech).
      this.ws = new WebSocket(url, [
        "realtime",
        `openai-insecure-api-key.${ephemeral}`,
        "openai-beta.realtime-v1",
      ]);
      this.ws.onopen = () => this._onOpen();
      this.ws.onmessage = (evt) => this._onMessage(evt);
      this.ws.onerror = (e) => this.onError(e);
      this.ws.onclose = () => {
        if (this.state !== "stopping") this.stop();
      };

      await this._startMicCapture();
    } catch (err) {
      this.onError(err);
      this.stop();
    }
  }

  private _onOpen() {
    const cfg = this.cfg!;
    const tools: unknown[] = [];
    if (cfg.kb.enabled && cfg.kb.collectionIds.length) {
      if (cfg.kb.provider === "xai_file_search") {
        // xAI server-side RAG. The model searches during generation and surfaces
        // a `collections_search` function_call as a trailing record (no client
        // execution, no function_call_output, no citations).
        tools.push({
          type: "file_search",
          vector_store_ids: cfg.kb.collectionIds,
          max_num_results: cfg.kb.maxNumResults || 10,
        });
      } else {
        // Custom client tool — we execute it via the proxy and feed chunks back.
        tools.push({
          type: "function",
          name: "search_knowledge_base",
          description:
            "Search the internal knowledge base for compliance rules, statutes, scripts, objections, rebuttals and product details. Call whenever you need exact wording or facts you are unsure of.",
          parameters: {
            type: "object",
            properties: { query: { type: "string", description: "Plain-text search query." } },
            required: ["query"],
          },
        });
      }
    }
    if (cfg.webSearch) tools.push({ type: "web_search" });
    for (const t of cfg.tools) {
      if (!t.enabled) continue;
      tools.push({ type: "function", name: t.name, description: t.description, parameters: t.parameters });
    }

    this.ws!.send(
      JSON.stringify({
        type: "session.update",
        session: {
          instructions: cfg.instructions,
          voice: this.voice || cfg.voice,
          // Bare server_vad (xAI reference default) — enables reliable barge-in.
          // Fragmentation from VAD splits is handled by consolidating user items
          // into one turn (see _setUserItem/_finalizeUserTurn), not by VAD tuning.
          turn_detection: { type: "server_vad" },
          audio: {
            input: {
              format: { type: "audio/pcm", rate: SAMPLE_RATE },
              transcription: { model: "grok-transcribe" },
            },
            output: { format: { type: "audio/pcm", rate: SAMPLE_RATE } },
          },
          tools,
        },
      })
    );
    this.setState("live");
  }

  setVoice(voice: string) {
    this.voice = voice || null;
    if (this.state === "live" && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "session.update", session: { voice: this.voice } }));
    }
  }

  sendText(text: string): boolean {
    const t = (text || "").trim();
    if (!t) return false;
    if (this.state !== "live" || this.ws?.readyState !== WebSocket.OPEN) return false;
    // Typed/guided input has no speech to trigger the server's auto-interrupt,
    // so interrupt explicitly: cancel the in-flight response + stop playback so
    // this answer replaces (not queues behind) the previous one.
    this.interrupt();
    this.ws.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: { type: "message", role: "user", content: [{ type: "input_text", text: t }] },
      })
    );
    this.ws.send(JSON.stringify({ type: "response.create" }));
    return true;
  }

  /** Stop the agent now (cancel the in-flight response + clear local audio). */
  interrupt() {
    // Cancel only when a response is actually generating — avoids the server's
    // "cancellation failed: no active response" error.
    if (this._activeResponses > 0 && this.ws?.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify({ type: "response.cancel" })); } catch { /* ignore */ }
    }
    if (this._activeAssistantId) {
      this.onTranscript({ id: this._activeAssistantId, role: "assistant", final: true });
      this._activeAssistantId = null;
    }
    this._clearPlayback();
    this._suppressAudio = true;
  }

  private async _startMicCapture() {
    this.inputCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
    await this.inputCtx.audioWorklet.addModule("/pcm-worklet.js");
    this.sourceNode = this.inputCtx.createMediaStreamSource(this.micStream!);
    this.workletNode = new AudioWorkletNode(this.inputCtx, "pcm-capture-processor");
    this.workletNode.port.onmessage = (e: MessageEvent) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const b64 = floatTo16BitPCMBase64(e.data as Float32Array);
      this.ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: b64 }));
    };
    this.sourceNode.connect(this.workletNode);
    const sink = this.inputCtx.createGain();
    sink.gain.value = 0;
    this.workletNode.connect(sink);
    sink.connect(this.inputCtx.destination);
  }

  private _onMessage(evt: MessageEvent) {
    let event: any;
    try {
      event = JSON.parse(evt.data as string);
    } catch {
      return;
    }
    switch (event.type) {
      case "response.output_audio.delta":
        // Drop audio from a response the user already barged in on (until the
        // next response starts) so interrupted speech doesn't keep playing.
        if (event.delta && !this._suppressAudio) this._enqueueAudio(event.delta);
        break;
      case "response.output_audio_transcript.delta": {
        if (!this._activeAssistantId) {
          // The agent is actually starting to speak now → the user's turn is
          // complete. Finalize/log it here (NOT on response.created, which can
          // fire multiple times for one utterance and split it into dupes).
          this._finalizeUserTurn();
          this._activeAssistantId = event.response_id || `a-${Date.now()}`;
          this.onTranscript({ id: this._activeAssistantId!, role: "assistant", text: event.delta || "", final: false });
        } else {
          this.onTranscript({ id: this._activeAssistantId, role: "assistant", appendText: event.delta || "", final: false });
        }
        break;
      }
      case "response.output_audio_transcript.done":
        if (this._activeAssistantId) {
          this.onTranscript({ id: this._activeAssistantId, role: "assistant", text: event.transcript ?? undefined, final: true });
        }
        this._activeAssistantId = null;
        break;
      // The authoritative user transcript lives on the committed conversation
      // item; transcription.* events are supplemental. We feed all of them into
      // the same per-item map so the turn is captured no matter which arrives.
      case "conversation.item.added": {
        const it = event.item || {};
        if (it.role === "user" && Array.isArray(it.content)) {
          for (const c of it.content) {
            if (c?.type === "input_audio" && c.transcript) {
              this._setUserItem(it.id || event.item_id || "live", c.transcript);
              break;
            }
          }
        }
        break;
      }
      case "conversation.item.input_audio_transcription.delta":
      case "conversation.item.input_audio_transcription.updated":
        this._setUserItem(event.item_id || "live", event.transcript || event.delta || "");
        break;
      case "conversation.item.input_audio_transcription.completed":
        this._setUserItem(event.item_id || "live", event.transcript || "");
        break;
      case "response.created":
        this._activeResponses += 1;
        // A new response is starting — allow its audio (clears any barge-in
        // suppression from the response the user just interrupted).
        this._suppressAudio = false;
        break;
      case "response.function_call_arguments.done": {
        // Only EXECUTE tools we registered as client functions. Server-side tools
        // (collections_search/web_search/x_search/mcp) also emit this event but
        // must NOT be executed (no function_call_output, no response.create) —
        // doing so spawns a runaway extra response. They're recorded elsewhere.
        const nm = event.name as string;
        const isClient =
          nm === "search_knowledge_base" ||
          (this.cfg?.tools || []).some((t) => t.enabled && t.name === nm);
        if (isClient) this._handleToolCall(event);
        break;
      }
      // Best-effort capture of xAI's server-side web_search tool. It isn't a
      // client function, so it never hits _handleToolCall — we glean it from
      // the output-item lifecycle (shapes vary; we read defensively).
      case "response.output_item.added": {
        const it = event.item || {};
        if (it.type === "function_call" && this._isServerSearch(it.name)) {
          this.onToolUse({ name: "collections_search", status: "start" });
        } else if (typeof it.type === "string" && it.type.includes("web_search")) {
          const wid = it.id || event.item_id || `ws-${Date.now()}`;
          if (!this._wsIds.has(wid)) {
            this._wsIds.add(wid);
            this.onToolUse({
              name: "web_search",
              status: "start",
              query: it.action?.query || it.query,
            });
          }
        }
        break;
      }
      case "response.output_item.done": {
        const it = event.item || {};
        if (it.type === "function_call" && this._isServerSearch(it.name)) {
          // xAI ran the search server-side; capture the query and replay it
          // against the proxy purely to log the chunks for the trace.
          void this._recordServerSearch(it);
        } else if (typeof it.type === "string" && it.type.includes("web_search")) {
          const failed = it.status === "failed" || it.status === "error";
          this.onToolUse({
            name: "web_search",
            status: failed ? "error" : "done",
            query: it.action?.query || it.query,
            resultPreview: safePreview(
              it.results ?? it.action?.results ?? it.sources ?? it.output
            ),
          });
        }
        break;
      }
      case "response.done": {
        this._activeResponses = Math.max(0, this._activeResponses - 1);
        // Authoritative transcript: response.done carries the complete answer in
        // output[].content[].transcript. Reconcile against the streamed text
        // (Train keeps the longer) so dropped deltas / barge-in can't truncate it.
        const out = event.response?.output;
        const rid = event.response?.id;
        if (Array.isArray(out) && rid) {
          const text = out
            .filter((i: any) => i.type === "message" && i.role === "assistant")
            .map((i: any) => (i.content || []).map((c: any) => c.transcript || c.text || "").join(""))
            .join(" ")
            .trim();
          if (text) this.onTranscript({ id: rid, role: "assistant", text, final: true });
        }
        break;
      }
      case "input_audio_buffer.speech_started":
        // Barge-in. Finalize the Coach's in-flight segment so it's still logged…
        if (this._activeAssistantId) {
          this.onTranscript({ id: this._activeAssistantId, role: "assistant", final: true });
          this._activeAssistantId = null;
        }
        // …stop local playback immediately, and IGNORE any further audio from the
        // interrupted response until the next response starts. (The server
        // auto-interrupts on server_vad; we do NOT send response.cancel — that
        // throws "no active response" between turns and isn't needed.)
        this._clearPlayback();
        this._suppressAudio = true;
        break;
      case "error":
        this.onError(event.error || event);
        break;
      default:
        break;
    }
  }

  private async _handleToolCall(event: any) {
    const cfg = this.cfg!;
    const callId = event.call_id;
    const name = event.name as string;
    let args: any = {};
    try {
      args = JSON.parse(event.arguments || "{}");
    } catch {
      args = {};
    }
    let output = "{}";
    const t0 = performance.now();
    const ms = () => Math.round(performance.now() - t0);
    try {
      const idToken = await cfg.getIdToken();
      if (name === "search_knowledge_base") {
        this.onToolUse({ name, status: "start", query: args.query, args });
        const r = await fetch(`${cfg.proxyBase}/search`, {
          method: "POST",
          headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            query: args.query || "",
            collectionIds: cfg.kb.collectionIds,
            retrievalMode: cfg.kb.retrievalMode,
            limit: cfg.kb.limit,
          }),
        });
        const data = await r.json();
        output = JSON.stringify(data);
        const raw = Array.isArray(data.results) ? data.results : [];
        const results: ToolChunk[] = raw.slice(0, 12).map((x: any) => {
          const c: ToolChunk = { content: String(x?.content ?? "").slice(0, 2000) };
          if (typeof x?.score === "number") c.score = x.score;
          if (x?.fileId != null) c.fileId = String(x.fileId);
          return c;
        });
        this.onToolUse({
          name,
          status: r.ok ? "done" : "error",
          query: args.query,
          args,
          resultCount: raw.length,
          results,
          latencyMs: ms(),
          error: r.ok ? undefined : safePreview(data?.error || data?.detail),
        });
      } else {
        const tool = cfg.tools.find((t) => t.name === name);
        this.onToolUse({ name, status: "start", args });
        if (tool) {
          const r = await fetch(`${cfg.proxyBase}/tool`, {
            method: "POST",
            headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ url: tool.binding.url, method: tool.binding.method, body: args }),
          });
          const data = await r.json();
          output = JSON.stringify(data);
          this.onToolUse({
            name,
            status: r.ok ? "done" : "error",
            args,
            httpStatus: typeof data?.status === "number" ? data.status : r.status,
            resultPreview: safePreview(data?.body ?? data),
            latencyMs: ms(),
            error: r.ok ? undefined : safePreview(data?.error || data?.detail),
          });
        } else {
          output = JSON.stringify({ error: `Unknown tool ${name}` });
          this.onToolUse({ name, status: "error", args, error: `Unknown tool ${name}` });
        }
      }
    } catch (err) {
      output = JSON.stringify({ error: String(err), results: [] });
      this.onToolUse({ name, status: "error", args, error: String(err), latencyMs: ms() });
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: callId, output },
      })
    );
    this.ws.send(JSON.stringify({ type: "response.create" }));
  }

  /** Names xAI uses for server-side retrieval (executed without a client round-trip). */
  private _isServerSearch(name?: string): boolean {
    return name === "collections_search" || name === "file_search";
  }

  /** Parse the (double-stringified) query out of a collections_search call. */
  private _parseSearchQuery(argStr?: string): string | undefined {
    try {
      const o = JSON.parse(argStr || "{}");
      const inner =
        typeof o.search_request === "string" ? JSON.parse(o.search_request) : o.search_request;
      return (inner && inner.query) || o.query || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * xAI ran file_search server-side (no chunks in the stream). Record the query
   * and replay it against the proxy /search purely to capture the chunks for the
   * trace/dashboard — this does NOT feed the model (it already has the results).
   */
  private async _recordServerSearch(item: any) {
    const cfg = this.cfg!;
    const query = this._parseSearchQuery(item?.arguments);
    const t0 = performance.now();
    let results: ToolChunk[] | undefined;
    let error: string | undefined;
    try {
      if (query && cfg.kb.collectionIds.length) {
        const idToken = await cfg.getIdToken();
        const r = await fetch(`${cfg.proxyBase}/search`, {
          method: "POST",
          headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            collectionIds: cfg.kb.collectionIds,
            retrievalMode: cfg.kb.retrievalMode,
            limit: cfg.kb.limit,
          }),
        });
        const data = await r.json();
        if (!r.ok) error = safePreview(data?.error || data?.detail);
        const raw = Array.isArray(data.results) ? data.results : [];
        results = raw.slice(0, 12).map((x: any) => {
          const c: ToolChunk = { content: String(x?.content ?? "").slice(0, 2000) };
          if (typeof x?.score === "number") c.score = x.score;
          if (x?.fileId != null) c.fileId = String(x.fileId);
          return c;
        });
      }
    } catch (e) {
      error = String(e);
    }
    this.onToolUse({
      name: "collections_search",
      status: error ? "error" : "done",
      query,
      resultCount: results?.length,
      results,
      latencyMs: Math.round(performance.now() - t0),
      error,
    });
  }

  /** Record/append a user transcription item and emit the consolidated turn live. */
  private _setUserItem(itemId: string, transcript?: string) {
    const text = (transcript || "").trim();
    if (!text) return;
    if (!this._turnItems.has(itemId)) this._turnOrder.push(itemId);
    this._turnItems.set(itemId, text);
    const joined = this._turnOrder.map((id) => this._turnItems.get(id) || "").join(" ").trim();
    this.onTranscript({ id: this._userTurnId, role: "user", text: joined, final: false });
  }

  /** Finalize (and log) the consolidated user turn; start a fresh turn id. */
  private _finalizeUserTurn() {
    if (!this._turnOrder.length) return;
    const joined = this._turnOrder.map((id) => this._turnItems.get(id) || "").join(" ").trim();
    if (joined) this.onTranscript({ id: this._userTurnId, role: "user", text: joined, final: true });
    this._turnItems.clear();
    this._turnOrder = [];
    this._userTurnSeq += 1;
    this._userTurnId = `u-turn-${this._userTurnSeq}`;
  }

  private _enqueueAudio(base64Pcm: string) {
    this._playQueue.push(base64PCM16ToFloat32(base64Pcm));
    if (!this._playing) {
      this._playing = true;
      this._playNext();
    }
  }

  private _playNext() {
    if (!this.outputCtx || this._playQueue.length === 0) {
      this._playing = false;
      this._currentSource = null;
      return;
    }
    const chunk = this._playQueue.shift()!;
    const buffer = this.outputCtx.createBuffer(1, chunk.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(chunk);
    const src = this.outputCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.outputCtx.destination);
    this._currentSource = src;
    src.onended = () => {
      if (this._currentSource === src) this._currentSource = null;
      this._playNext();
    };
    src.start();
  }

  /** Drop everything still queued and stop the chunk playing now (true barge-in). */
  private _clearPlayback() {
    this._playQueue = [];
    this._playing = false;
    if (this._currentSource) {
      try {
        this._currentSource.stop();
        this._currentSource.disconnect();
      } catch {
        /* already stopped */
      }
      this._currentSource = null;
    }
  }

  stop() {
    if (this.state === "idle") return;
    // Flush any in-progress user turn (e.g. ended mid-utterance) so it's logged.
    this._finalizeUserTurn();
    this.setState("stopping");
    this._clearPlayback();
    try {
      this.workletNode?.disconnect();
      this.sourceNode?.disconnect();
    } catch {
      /* ignore */
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    try {
      this.inputCtx?.close();
    } catch {
      /* ignore */
    }
    try {
      this.outputCtx?.close();
    } catch {
      /* ignore */
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
    }
    this.ws = null;
    this.inputCtx = null;
    this.outputCtx = null;
    this.workletNode = null;
    this.sourceNode = null;
    this._activeAssistantId = null;
    this._wsIds.clear();
    this._suppressAudio = false;
    this._activeResponses = 0;
    this._playQueue = [];
    this._playing = false;
    this._currentSource = null;
    this._turnItems.clear();
    this._turnOrder = [];
    this.setState("idle");
  }
}

// Compact, safe stringify for tool result previews (caps size, never throws).
function safePreview(v: unknown): string | undefined {
  if (v == null) return undefined;
  try {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s ? s.slice(0, 4000) : undefined;
  } catch {
    return undefined;
  }
}

// ---- audio helpers (24kHz PCM16 <-> base64) ----
function floatTo16BitPCMBase64(float32: Float32Array): string {
  const pcm16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return bufferToBase64(new Uint8Array(pcm16.buffer));
}
function base64PCM16ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const pcm16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768.0;
  return float32;
}
function bufferToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}
