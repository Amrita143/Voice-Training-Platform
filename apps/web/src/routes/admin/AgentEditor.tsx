import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import {
  emptyAgent,
  getAgent,
  createAgent,
  updateAgent,
} from "../../lib/agents";
import { humanizeError } from "../../lib/errors";
import {
  GROK_VOICES,
  type AgentDoc,
  type AgentStatus,
  type CustomToolDef,
  type GrokVoice,
  type RetrievalMode,
} from "@avtp/shared";

type HttpMethod = CustomToolDef["binding"]["method"];
const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

interface ToolDraft {
  name: string;
  description: string;
  enabled: boolean;
  parametersText: string;
  url: string;
  method: HttpMethod;
}

interface Form {
  name: string;
  description: string;
  status: AgentStatus;
  model: string;
  systemPrompt: string;
  defaultVoice: GrokVoice;
  allowed: GrokVoice[];
  kbEnabled: boolean;
  kbProvider: "custom" | "xai_file_search";
  collectionIdsText: string;
  retrievalMode: RetrievalMode;
  maxNumResults: number;
  limit: number;
  dedupe: boolean;
  webSearch: boolean;
  tools: ToolDraft[];
}

function toForm(a: AgentDoc): Form {
  return {
    name: a.name,
    description: a.description || "",
    status: a.status,
    model: a.model,
    systemPrompt: a.systemPrompt,
    defaultVoice: a.voices.default,
    allowed: a.voices.allowed,
    kbEnabled: a.knowledgeBase.enabled,
    kbProvider: a.knowledgeBase.provider || "custom",
    collectionIdsText: (a.knowledgeBase.collectionIds || []).join("\n"),
    retrievalMode: a.knowledgeBase.retrievalMode,
    maxNumResults: a.knowledgeBase.maxNumResults,
    limit: a.knowledgeBase.limit,
    dedupe: a.knowledgeBase.dedupe,
    webSearch: a.webSearch.enabled,
    tools: (a.tools || []).map((t) => ({
      name: t.name,
      description: t.description,
      enabled: t.enabled,
      parametersText: JSON.stringify(t.parameters ?? {}, null, 2),
      url: t.binding?.url || "",
      method: t.binding?.method || "POST",
    })),
  };
}

function toAgent(f: Form, base: AgentDoc, uid: string): AgentDoc {
  const collectionIds = f.collectionIdsText
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const allowed = f.allowed.includes(f.defaultVoice)
    ? f.allowed
    : [f.defaultVoice, ...f.allowed];

  const tools: CustomToolDef[] = f.tools.map((t, i) => {
    let parameters: Record<string, unknown> = {};
    if (t.parametersText.trim()) {
      try {
        parameters = JSON.parse(t.parametersText);
      } catch {
        throw new Error(`Tool #${i + 1} (“${t.name || "unnamed"}”): parameters is not valid JSON.`);
      }
    }
    return {
      id: `tool_${i}_${(t.name || "tool").replace(/\W+/g, "_")}`,
      name: t.name.trim(),
      description: t.description.trim(),
      enabled: t.enabled,
      parameters,
      binding: { type: "http", url: t.url.trim(), method: t.method, timeoutMs: 10000 },
    };
  });

  return {
    ...base,
    name: f.name.trim(),
    description: f.description.trim(),
    status: f.status,
    model: f.model.trim() || base.model,
    systemPrompt: f.systemPrompt,
    voices: { default: f.defaultVoice, allowed },
    knowledgeBase: {
      enabled: f.kbEnabled,
      provider: f.kbProvider,
      collectionIds,
      maxNumResults: Number(f.maxNumResults) || 10,
      retrievalMode: f.retrievalMode,
      dedupe: f.dedupe,
      limit: Number(f.limit) || 10,
    },
    webSearch: { enabled: f.webSearch },
    tools,
    updatedAt: Date.now(),
    updatedBy: uid,
  };
}

const inputCls =
  "rounded-lg bg-bg border border-border px-3 py-2 outline-none focus:border-accent text-sm w-full";
const label = "block text-xs text-muted";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-panel p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export default function AgentEditor() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const { user } = useAuth();
  const nav = useNavigate();

  const [base, setBase] = useState<AgentDoc | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (isNew) {
        const a = emptyAgent(user!.uid);
        setBase(a);
        setForm(toForm(a));
      } else {
        try {
          const a = await getAgent(id!);
          if (!a) {
            setErr("Agent not found.");
            return;
          }
          setBase(a);
          setForm(toForm(a));
        } catch (e) {
          setErr(humanizeError(e));
        }
      }
    })();
  }, [id]);

  if (err && !form) return <div className="max-w-3xl mx-auto px-6 py-8 text-danger">{err}</div>;
  if (!form || !base) return <div className="max-w-3xl mx-auto px-6 py-8 text-muted">Loading…</div>;

  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  const toggleAllowed = (v: GrokVoice) =>
    set(
      "allowed",
      form.allowed.includes(v)
        ? form.allowed.filter((x) => x !== v)
        : [...form.allowed, v]
    );

  const addTool = () =>
    set("tools", [
      ...form.tools,
      { name: "", description: "", enabled: true, parametersText: "", url: "", method: "POST" },
    ]);
  const setTool = (i: number, patch: Partial<ToolDraft>) =>
    set(
      "tools",
      form.tools.map((t, idx) => (idx === i ? { ...t, ...patch } : t))
    );
  const removeTool = (i: number) =>
    set("tools", form.tools.filter((_, idx) => idx !== i));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!form.name.trim()) return setErr("Name is required.");
    setBusy(true);
    try {
      const data = toAgent(form, base, user!.uid);
      if (isNew) await createAgent(data);
      else await updateAgent(id!, data);
      nav("/agents");
    } catch (e) {
      setErr(humanizeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="max-w-3xl mx-auto px-6 py-8 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">
          {isNew ? "New voice agent" : "Edit voice agent"}
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => nav("/agents")}
            className="rounded-lg border border-border px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-accent text-black font-semibold px-4 py-2 text-sm disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <Section title="Basics">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="sm:col-span-2">
            <span className={label}>Name</span>
            <input
              className={inputCls}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Everest Debt Collection Process Trainer"
            />
          </label>
          <label>
            <span className={label}>Status</span>
            <select
              className={inputCls}
              value={form.status}
              onChange={(e) => set("status", e.target.value as AgentStatus)}
            >
              <option value="draft">draft</option>
              <option value="published">published</option>
              <option value="archived">archived</option>
            </select>
          </label>
        </div>
        <label className="block">
          <span className={label}>Description</span>
          <input
            className={inputCls}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </label>
        <label className="block">
          <span className={label}>Model</span>
          <input
            className={inputCls}
            value={form.model}
            onChange={(e) => set("model", e.target.value)}
          />
        </label>
      </Section>

      <Section title="System prompt">
        <textarea
          className={`${inputCls} font-mono text-xs leading-relaxed`}
          rows={14}
          value={form.systemPrompt}
          onChange={(e) => set("systemPrompt", e.target.value)}
          placeholder="You are the … training agent…"
        />
      </Section>

      <Section title="Voice">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <label>
            <span className={label}>Default voice</span>
            <select
              className={inputCls}
              value={form.defaultVoice}
              onChange={(e) => set("defaultVoice", e.target.value as GrokVoice)}
            >
              {GROK_VOICES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-2">
            <span className={label}>Allowed voices (trainee can pick)</span>
            <div className="mt-1 flex flex-wrap gap-3">
              {GROK_VOICES.map((v) => (
                <label key={v} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={form.allowed.includes(v) || v === form.defaultVoice}
                    disabled={v === form.defaultVoice}
                    onChange={() => toggleAllowed(v)}
                  />
                  {v}
                </label>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Knowledge base">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.kbEnabled}
            onChange={(e) => set("kbEnabled", e.target.checked)}
          />
          Enable knowledge-base retrieval (RAG)
        </label>
        {form.kbEnabled && (
          <>
            <label className="block">
              <span className={label}>Retrieval method</span>
              <select
                className={inputCls}
                value={form.kbProvider}
                onChange={(e) => set("kbProvider", e.target.value as Form["kbProvider"])}
              >
                <option value="custom">Custom tool — search_knowledge_base (full chunk capture, multi-query)</option>
                <option value="xai_file_search">xAI file_search — server-side RAG (one grounded answer, fewer turns)</option>
              </select>
              <span className="block text-xs text-muted mt-1">
                {form.kbProvider === "xai_file_search"
                  ? "xAI runs the search during generation (collections_search). Cleaner & less chatty; chunks are replayed server-side for the trace. Retrieval mode / de-dupe below are ignored."
                  : "We execute the search via the proxy and feed chunks back. Full control + every chunk captured; can produce multiple search turns."}
              </span>
            </label>
            <label className="block">
              <span className={label}>Collection IDs (one per line)</span>
              <textarea
                className={`${inputCls} font-mono text-xs`}
                rows={3}
                value={form.collectionIdsText}
                onChange={(e) => set("collectionIdsText", e.target.value)}
                placeholder="collection_58eb8df0-…"
              />
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
              <label>
                <span className={label}>Retrieval mode</span>
                <select
                  className={inputCls}
                  value={form.retrievalMode}
                  onChange={(e) => set("retrievalMode", e.target.value as RetrievalMode)}
                >
                  <option value="hybrid">hybrid</option>
                  <option value="semantic">semantic</option>
                  <option value="keyword">keyword</option>
                </select>
              </label>
              <label>
                <span className={label}>Max results</span>
                <input
                  type="number"
                  className={inputCls}
                  value={form.maxNumResults}
                  onChange={(e) => set("maxNumResults", Number(e.target.value))}
                />
              </label>
              <label>
                <span className={label}>Return limit</span>
                <input
                  type="number"
                  className={inputCls}
                  value={form.limit}
                  onChange={(e) => set("limit", Number(e.target.value))}
                />
              </label>
              <label className="flex items-center gap-2 text-sm pb-2">
                <input
                  type="checkbox"
                  checked={form.dedupe}
                  onChange={(e) => set("dedupe", e.target.checked)}
                />
                De-dupe
              </label>
            </div>
          </>
        )}
      </Section>

      <Section title="Web search">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.webSearch}
            onChange={(e) => set("webSearch", e.target.checked)}
          />
          Allow this agent to use xAI web search
        </label>
      </Section>

      <Section title="Custom tools">
        {form.tools.length === 0 && (
          <p className="text-xs text-muted">No custom tools.</p>
        )}
        {form.tools.map((t, i) => (
          <div key={i} className="rounded-lg border border-border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">Tool #{i + 1}</span>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={t.enabled}
                    onChange={(e) => setTool(i, { enabled: e.target.checked })}
                  />
                  enabled
                </label>
                <button
                  type="button"
                  onClick={() => removeTool(i)}
                  className="text-xs text-danger"
                >
                  remove
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                className={inputCls}
                placeholder="name (e.g. lookup_account)"
                value={t.name}
                onChange={(e) => setTool(i, { name: e.target.value })}
              />
              <input
                className={inputCls}
                placeholder="description"
                value={t.description}
                onChange={(e) => setTool(i, { description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <select
                className={inputCls}
                value={t.method}
                onChange={(e) => setTool(i, { method: e.target.value as HttpMethod })}
              >
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                className={`${inputCls} sm:col-span-3`}
                placeholder="https://endpoint… (allow-listed)"
                value={t.url}
                onChange={(e) => setTool(i, { url: e.target.value })}
              />
            </div>
            <textarea
              className={`${inputCls} font-mono text-xs`}
              rows={4}
              placeholder='JSON Schema, e.g. {"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}'
              value={t.parametersText}
              onChange={(e) => setTool(i, { parametersText: e.target.value })}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={addTool}
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-bg"
        >
          + Add tool
        </button>
      </Section>

      {err && <p className="text-sm text-danger">{err}</p>}
    </form>
  );
}
