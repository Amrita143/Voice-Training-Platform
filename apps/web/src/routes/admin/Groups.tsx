import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  type GroupRow,
} from "../../lib/groups";
import { listUsers, type UserRow } from "../../lib/userAdmin";
import { listAgents, type AgentWithId } from "../../lib/agents";
import { humanizeError } from "../../lib/errors";

export default function Groups() {
  const { user } = useAuth();
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [agents, setAgents] = useState<AgentWithId[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");

  // editor state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [members, setMembers] = useState<Set<string>>(new Set());
  const [agentIds, setAgentIds] = useState<Set<string>>(new Set());
  const [lim, setLim] = useState({ perDayMin: 0, perWeekMin: 0, perMonthMin: 0 });

  const reload = async () => {
    setErr(null);
    try {
      const [g, u, a] = await Promise.all([listGroups(), listUsers(), listAgents()]);
      setGroups(g);
      setUsers(u);
      setAgents(a);
    } catch (e) {
      setErr(humanizeError(e));
    }
  };
  useEffect(() => {
    reload();
  }, []);

  const selected = useMemo(
    () => groups?.find((g) => g.id === sel) || null,
    [groups, sel]
  );

  const select = (g: GroupRow) => {
    setSel(g.id);
    setName(g.name || "");
    setDescription(g.description || "");
    setMembers(new Set(g.memberUids || []));
    setAgentIds(new Set(g.assignedAgentIds || []));
    setLim({
      perDayMin: g.usageLimits?.perDayMin || 0,
      perWeekMin: g.usageLimits?.perWeekMin || 0,
      perMonthMin: g.usageLimits?.perMonthMin || 0,
    });
  };

  const create = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const id = await createGroup({ name: newName, createdBy: user!.uid });
      setNewName("");
      await reload();
      const g = (await listGroups()).find((x) => x.id === id);
      if (g) select(g);
    } catch (e) {
      setErr(humanizeError(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!sel) return;
    setBusy(true);
    setErr(null);
    try {
      await updateGroup(sel, {
        name: name.trim(),
        description: description.trim(),
        memberUids: [...members],
        assignedAgentIds: [...agentIds],
        usageLimits: {
          perDayMin: lim.perDayMin || 0,
          perWeekMin: lim.perWeekMin || 0,
          perMonthMin: lim.perMonthMin || 0,
        },
      });
      await reload();
    } catch (e) {
      setErr(humanizeError(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (g: GroupRow) => {
    if (!confirm(`Delete group “${g.name}”?`)) return;
    try {
      await deleteGroup(g.id);
      if (sel === g.id) setSel(null);
      await reload();
    } catch (e) {
      setErr(humanizeError(e));
    }
  };

  const toggle = (set: Set<string>, setFn: (s: Set<string>) => void, id: string) => {
    const n = new Set(set);
    n.has(id) ? n.delete(id) : n.add(id);
    setFn(n);
  };

  const input =
    "rounded-lg bg-bg border border-border px-3 py-2 outline-none focus:border-accent text-sm w-full";

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <h2 className="text-xl font-semibold">Groups</h2>
      <p className="text-sm text-muted mt-1">
        Group trainees, then assign voice agents to the whole group at once.
      </p>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-[18rem_1fr] gap-5">
        {/* left: list + create */}
        <div>
          <div className="flex gap-2">
            <input
              className={input}
              placeholder="New group name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button
              onClick={create}
              disabled={busy || !newName.trim()}
              className="rounded-lg bg-accent text-black font-semibold px-3 text-sm disabled:opacity-50"
            >
              Add
            </button>
          </div>
          <div className="mt-3 rounded-xl border border-border divide-y divide-border">
            {groups === null && <div className="px-3 py-3 text-muted text-sm">Loading…</div>}
            {groups?.length === 0 && (
              <div className="px-3 py-3 text-muted text-sm">No groups yet.</div>
            )}
            {groups?.map((g) => (
              <button
                key={g.id}
                onClick={() => select(g)}
                className={
                  "w-full text-left px-3 py-2.5 text-sm flex items-center justify-between " +
                  (sel === g.id ? "bg-panel" : "hover:bg-panel/50")
                }
              >
                <span>
                  <span className="font-medium">{g.name}</span>
                  <span className="text-muted ml-2 text-xs">
                    {g.memberUids?.length || 0} members · {g.assignedAgentIds?.length || 0} agents
                  </span>
                </span>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(g);
                  }}
                  className="text-danger text-xs"
                >
                  delete
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* right: editor */}
        <div className="rounded-xl border border-border bg-panel p-4">
          {!selected ? (
            <p className="text-sm text-muted">Select a group to edit, or create one.</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="text-xs text-muted">
                  Name
                  <input className={`mt-1 ${input}`} value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="text-xs text-muted">
                  Description
                  <input className={`mt-1 ${input}`} value={description} onChange={(e) => setDescription(e.target.value)} />
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-muted mb-1">
                    Members ({members.size})
                  </div>
                  <div className="rounded-lg border border-border max-h-56 overflow-y-auto divide-y divide-border">
                    {users.map((u) => (
                      <label key={u.uid} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={members.has(u.uid)}
                          onChange={() => toggle(members, setMembers, u.uid)}
                        />
                        <span>{u.userid}</span>
                        <span className="text-muted text-xs">({u.role})</span>
                      </label>
                    ))}
                    {users.length === 0 && (
                      <div className="px-3 py-2 text-muted text-sm">No users.</div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-muted mb-1">
                    Assigned agents ({agentIds.size})
                  </div>
                  <div className="rounded-lg border border-border max-h-56 overflow-y-auto divide-y divide-border">
                    {agents.map((a) => (
                      <label key={a.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={agentIds.has(a.id)}
                          onChange={() => toggle(agentIds, setAgentIds, a.id)}
                        />
                        <span>{a.name || "(untitled)"}</span>
                        <span className="text-muted text-xs">{a.status}</span>
                      </label>
                    ))}
                    {agents.length === 0 && (
                      <div className="px-3 py-2 text-muted text-sm">No agents.</div>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-xs text-muted mb-1">
                  Group usage limits — minutes of interaction (0 = no group limit)
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {([
                    ["perDayMin", "Per day"],
                    ["perWeekMin", "Per week"],
                    ["perMonthMin", "Per month"],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="text-xs text-muted">
                      {label}
                      <input
                        type="number"
                        min={0}
                        className={`mt-1 ${input}`}
                        value={lim[key]}
                        onChange={(e) =>
                          setLim((p) => ({ ...p, [key]: Math.max(0, Number(e.target.value) || 0) }))
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={save}
                  disabled={busy}
                  className="rounded-lg bg-accent text-black font-semibold px-4 py-2 text-sm disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Save group"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {err && <p className="mt-3 text-sm text-danger">{err}</p>}
    </div>
  );
}
