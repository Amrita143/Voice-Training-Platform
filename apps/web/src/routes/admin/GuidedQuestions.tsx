import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { listAgents, type AgentWithId } from "../../lib/agents";
import { listUsers, type UserRow } from "../../lib/userAdmin";
import { listGroups, type GroupRow } from "../../lib/groups";
import {
  listSections,
  listSubsections,
  listQuestions,
  createSection,
  updateSection,
  deleteSection,
  createSubsection,
  updateSubsection,
  deleteSubsection,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  type Section,
  type Subsection,
  type Question,
} from "../../lib/guidedQuestions";
import { humanizeError } from "../../lib/errors";

const inputCls =
  "rounded-md bg-bg border border-border px-2.5 py-1.5 text-sm outline-none focus:border-accent";

async function swap<T extends { id: string; order: number }>(
  list: T[],
  id: string,
  dir: -1 | 1,
  update: (id: string, patch: { order: number }) => Promise<void>
) {
  const i = list.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  await Promise.all([
    update(list[i].id, { order: list[j].order }),
    update(list[j].id, { order: list[i].order }),
  ]);
}

export default function GuidedQuestions() {
  const { user } = useAuth();
  const [agents, setAgents] = useState<AgentWithId[]>([]);
  const [agentId, setAgentId] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [subs, setSubs] = useState<Subsection[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [newSection, setNewSection] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listAgents(), listUsers(), listGroups()])
      .then(([a, u, g]) => {
        setAgents(a.filter((x) => x.status !== "archived"));
        setUsers(u.filter((x) => x.role === "trainee"));
        setGroups(g);
        if (a.length && !agentId) setAgentId(a[0].id);
      })
      .catch((e) => setErr(humanizeError(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadGuide = async (aid: string) => {
    if (!aid) return;
    try {
      const [s, ss, q] = await Promise.all([listSections(aid), listSubsections(aid), listQuestions(aid)]);
      setSections(s);
      setSubs(ss);
      setQuestions(q);
    } catch (e) {
      setErr(humanizeError(e));
    }
  };
  useEffect(() => {
    loadGuide(agentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  const reload = () => loadGuide(agentId);
  const wrap = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await reload();
    } catch (e) {
      setErr(humanizeError(e));
    }
  };

  const addSection = () =>
    wrap(async () => {
      if (!newSection.trim()) return;
      await createSection(agentId, newSection.trim(), (sections.at(-1)?.order ?? 0) + 1, user!.uid);
      setNewSection("");
    });

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold">Guided Questions</h2>
          <p className="text-sm text-muted mt-1">
            Curated prompts trainees can click during a session. Restrict a section to specific
            trainees/groups, or show it to everyone.
          </p>
        </div>
        <label className="text-xs text-muted">
          Agent
          <select className={`mt-1 block ${inputCls}`} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name || "(untitled)"}</option>
            ))}
          </select>
        </label>
      </div>

      {agents.length === 0 && <p className="mt-6 text-sm text-muted">Create an agent first.</p>}

      <div className="mt-6 space-y-4">
        {sections.map((s, i) => (
          <SectionCard
            key={s.id}
            section={s}
            index={i}
            total={sections.length}
            allSections={sections}
            subs={subs.filter((x) => x.sectionId === s.id)}
            questions={questions.filter((q) => q.sectionId === s.id)}
            users={users}
            groups={groups}
            onChange={reload}
            onError={(e) => setErr(humanizeError(e))}
          />
        ))}
      </div>

      {agentId && (
        <div className="mt-5 flex gap-2">
          <input
            className={`flex-1 ${inputCls}`}
            placeholder="New section title (e.g. Call Handling)"
            value={newSection}
            onChange={(e) => setNewSection(e.target.value)}
          />
          <button onClick={addSection} disabled={!newSection.trim()} className="rounded-md bg-accent text-black font-semibold px-4 text-sm disabled:opacity-50">
            Add section
          </button>
        </div>
      )}
      {err && <p className="mt-3 text-sm text-danger">{err}</p>}
    </div>
  );
}

function SectionCard(props: {
  section: Section;
  index: number;
  total: number;
  allSections: Section[];
  subs: Subsection[];
  questions: Question[];
  users: UserRow[];
  groups: GroupRow[];
  onChange: () => void;
  onError: (e: unknown) => void;
}) {
  const { section, index, total, allSections, subs, questions, users, groups, onChange, onError } = props;
  const [showVis, setShowVis] = useState(false);
  const [newQ, setNewQ] = useState("");
  const [newQSub, setNewQSub] = useState("");
  const [newSub, setNewSub] = useState("");

  const wrap = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onChange();
    } catch (e) {
      onError(e);
    }
  };

  const looseQs = questions.filter((q) => !q.subsectionId).sort((a, b) => a.order - b.order);

  return (
    <div className="rounded-xl border border-border bg-panel p-4">
      <div className="flex items-center gap-2">
        <input
          className={`flex-1 font-medium ${inputCls}`}
          defaultValue={section.title}
          onBlur={(e) => e.target.value !== section.title && wrap(() => updateSection(section.id, { title: e.target.value }))}
        />
        <button title="Move up" disabled={index === 0} onClick={() => wrap(() => swap(allSections, section.id, -1, updateSection))} className="px-2 text-muted disabled:opacity-30">↑</button>
        <button title="Move down" disabled={index === total - 1} onClick={() => wrap(() => swap(allSections, section.id, 1, updateSection))} className="px-2 text-muted disabled:opacity-30">↓</button>
        <button onClick={() => confirm(`Delete section “${section.title}” and its questions?`) && wrap(() => deleteSection(section.id))} className="px-2 text-danger text-sm">Delete</button>
      </div>

      {/* visibility */}
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className="text-muted">Visible to:</span>
        <select
          className={inputCls}
          value={section.visibility}
          onChange={(e) => wrap(() => updateSection(section.id, { visibility: e.target.value as Section["visibility"] }))}
        >
          <option value="all">Everyone with this agent</option>
          <option value="restricted">Specific trainees / groups</option>
        </select>
        {section.visibility === "restricted" && (
          <button onClick={() => setShowVis((v) => !v)} className="text-accent">
            {showVis ? "hide" : `manage (${section.allowedUserIds.length} trainees, ${section.allowedGroupIds.length} groups)`}
          </button>
        )}
      </div>
      {section.visibility === "restricted" && showVis && (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Picker
            title="Trainees"
            items={users.map((u) => ({ id: u.uid, label: u.userid }))}
            selected={section.allowedUserIds}
            onToggle={(id) =>
              wrap(() =>
                updateSection(section.id, {
                  allowedUserIds: toggle(section.allowedUserIds, id),
                })
              )
            }
          />
          <Picker
            title="Groups"
            items={groups.map((g) => ({ id: g.id, label: g.name }))}
            selected={section.allowedGroupIds}
            onToggle={(id) =>
              wrap(() =>
                updateSection(section.id, {
                  allowedGroupIds: toggle(section.allowedGroupIds, id),
                })
              )
            }
          />
        </div>
      )}

      {/* loose questions */}
      <div className="mt-3 space-y-1.5">
        {looseQs.map((q, qi) => (
          <QuestionRow key={q.id} q={q} list={looseQs} index={qi} subs={subs} onChange={onChange} onError={onError} />
        ))}
      </div>

      {/* subsections */}
      {subs.sort((a, b) => a.order - b.order).map((ss) => {
        const qs = questions.filter((q) => q.subsectionId === ss.id).sort((a, b) => a.order - b.order);
        return (
          <div key={ss.id} className="mt-3 border-t border-border pt-2">
            <div className="flex items-center gap-2">
              <input
                className={`flex-1 text-sm text-muted ${inputCls}`}
                defaultValue={ss.title}
                onBlur={(e) => e.target.value !== ss.title && wrap(() => updateSubsection(ss.id, { title: e.target.value }))}
              />
              <button onClick={() => confirm(`Delete subsection “${ss.title}”?`) && wrap(() => deleteSubsection(ss.id))} className="px-2 text-danger text-xs">✕</button>
            </div>
            <div className="mt-1.5 space-y-1.5 pl-2">
              {qs.map((q, qi) => (
                <QuestionRow key={q.id} q={q} list={qs} index={qi} subs={subs} onChange={onChange} onError={onError} />
              ))}
            </div>
          </div>
        );
      })}

      {/* add subsection + add question */}
      <div className="mt-3 flex flex-wrap gap-2">
        <input className={inputCls} placeholder="New subsection" value={newSub} onChange={(e) => setNewSub(e.target.value)} />
        <button
          onClick={() =>
            newSub.trim() &&
            wrap(async () => {
              await createSubsection(section.agentId, section.id, newSub.trim(), (subs.at(-1)?.order ?? 0) + 1);
              setNewSub("");
            })
          }
          className="rounded-md border border-border px-3 text-xs"
        >
          + Subsection
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <input className={`flex-1 min-w-[12rem] ${inputCls}`} placeholder="New question text" value={newQ} onChange={(e) => setNewQ(e.target.value)} />
        <select className={inputCls} value={newQSub} onChange={(e) => setNewQSub(e.target.value)}>
          <option value="">(no subsection)</option>
          {subs.map((ss) => (
            <option key={ss.id} value={ss.id}>{ss.title}</option>
          ))}
        </select>
        <button
          onClick={() =>
            newQ.trim() &&
            wrap(async () => {
              await createQuestion(section.agentId, section.id, newQSub || null, newQ.trim(), (questions.at(-1)?.order ?? 0) + 1);
              setNewQ("");
            })
          }
          className="rounded-md bg-accent text-black font-semibold px-3 text-sm"
        >
          Add question
        </button>
      </div>
    </div>
  );
}

function QuestionRow(props: {
  q: Question;
  list: Question[];
  index: number;
  subs: Subsection[];
  onChange: () => void;
  onError: (e: unknown) => void;
}) {
  const { q, list, index, subs, onChange, onError } = props;
  const wrap = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onChange();
    } catch (e) {
      onError(e);
    }
  };
  return (
    <div className="flex items-center gap-2">
      <input type="checkbox" title="Enabled" checked={q.enabled} onChange={(e) => wrap(() => updateQuestion(q.id, { enabled: e.target.checked }))} />
      <input
        className={`flex-1 ${inputCls} ${q.enabled ? "" : "opacity-50 line-through"}`}
        defaultValue={q.text}
        onBlur={(e) => e.target.value !== q.text && wrap(() => updateQuestion(q.id, { text: e.target.value }))}
      />
      <select
        className={`${inputCls} text-xs`}
        value={q.subsectionId || ""}
        onChange={(e) => wrap(() => updateQuestion(q.id, { subsectionId: e.target.value || null }))}
        title="Subsection"
      >
        <option value="">—</option>
        {subs.map((ss) => (
          <option key={ss.id} value={ss.id}>{ss.title}</option>
        ))}
      </select>
      <button disabled={index === 0} onClick={() => wrap(() => swap(list, q.id, -1, updateQuestion))} className="px-1.5 text-muted disabled:opacity-30">↑</button>
      <button disabled={index === list.length - 1} onClick={() => wrap(() => swap(list, q.id, 1, updateQuestion))} className="px-1.5 text-muted disabled:opacity-30">↓</button>
      <button onClick={() => wrap(() => deleteQuestion(q.id))} className="px-1.5 text-danger text-sm">✕</button>
    </div>
  );
}

function Picker(props: {
  title: string;
  items: { id: string; label: string }[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border">
      <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted border-b border-border">{props.title}</div>
      <div className="max-h-40 overflow-y-auto">
        {props.items.length === 0 && <div className="px-3 py-2 text-xs text-muted">None.</div>}
        {props.items.map((it) => (
          <label key={it.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
            <input type="checkbox" checked={props.selected.includes(it.id)} onChange={() => props.onToggle(it.id)} />
            {it.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function toggle(arr: string[], id: string): string[] {
  return arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];
}
