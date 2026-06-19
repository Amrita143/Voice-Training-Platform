import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  createUser,
  listUsers,
  setUserStatus,
  setUserAgents,
  setUserLimits,
  type UserRow,
} from "../../lib/userAdmin";
import { listAgents, type AgentWithId } from "../../lib/agents";
import { humanizeError } from "../../lib/errors";
import type { Role } from "@avtp/shared";

export default function Users() {
  const { user } = useAuth();
  const isSuper = user?.role === "superadmin";
  const roleOptions: Role[] = isSuper
    ? ["trainee", "admin", "superadmin"]
    : ["trainee"];

  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // create form
  const [userid, setUserid] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("trainee");
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // agent assignment modal
  const [agents, setAgents] = useState<AgentWithId[]>([]);
  const [assignUid, setAssignUid] = useState<string | null>(null);
  const [assignSet, setAssignSet] = useState<Set<string>>(new Set());

  // usage-limits modal
  const [limitsRow, setLimitsRow] = useState<UserRow | null>(null);
  const [lf, setLf] = useState({ maxSessionMinutes: 0, perDayMin: 0, perWeekMin: 0, perMonthMin: 0 });

  const reload = async () => {
    setLoadErr(null);
    try {
      setRows(await listUsers());
    } catch (e) {
      setLoadErr(humanizeError(e));
    }
  };
  useEffect(() => {
    reload();
    listAgents().then(setAgents).catch(() => {});
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormErr(null);
    setOkMsg(null);
    setBusy(true);
    try {
      await createUser({
        userid,
        displayName,
        password,
        role,
        createdBy: user!.uid,
      });
      setOkMsg(`Created “${userid}”. They must change password on first login.`);
      setUserid("");
      setDisplayName("");
      setPassword("");
      setRole("trainee");
      await reload();
    } catch (e) {
      setFormErr(humanizeError(e));
    } finally {
      setBusy(false);
    }
  };

  const canManage = (r: UserRow) =>
    r.uid !== user?.uid && (isSuper || r.role === "trainee");

  const toggleStatus = async (r: UserRow) => {
    const next = r.status === "disabled" ? "active" : "disabled";
    try {
      await setUserStatus(r.uid, next);
      await reload();
    } catch (e) {
      setLoadErr(humanizeError(e));
    }
  };

  const openAssign = (r: UserRow) => {
    setAssignUid(r.uid);
    setAssignSet(new Set(r.assignedAgentIds || []));
  };
  const saveAssign = async () => {
    if (!assignUid) return;
    try {
      await setUserAgents(assignUid, [...assignSet]);
      setAssignUid(null);
      await reload();
    } catch (e) {
      setLoadErr(humanizeError(e));
    }
  };
  const toggleAssign = (id: string) => {
    const n = new Set(assignSet);
    n.has(id) ? n.delete(id) : n.add(id);
    setAssignSet(n);
  };

  const openLimits = (r: UserRow) => {
    setLimitsRow(r);
    setLf({
      maxSessionMinutes: r.maxSessionMinutes || 0,
      perDayMin: r.usageLimits?.perDayMin || 0,
      perWeekMin: r.usageLimits?.perWeekMin || 0,
      perMonthMin: r.usageLimits?.perMonthMin || 0,
    });
  };
  const saveLimits = async () => {
    if (!limitsRow) return;
    try {
      await setUserLimits(limitsRow.uid, {
        maxSessionMinutes: lf.maxSessionMinutes || 0,
        usageLimits: {
          perDayMin: lf.perDayMin || 0,
          perWeekMin: lf.perWeekMin || 0,
          perMonthMin: lf.perMonthMin || 0,
        },
      });
      setLimitsRow(null);
      await reload();
    } catch (e) {
      setLoadErr(humanizeError(e));
    }
  };

  const input =
    "rounded-lg bg-bg border border-border px-3 py-2 outline-none focus:border-accent text-sm";

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <h2 className="text-xl font-semibold">Users</h2>
      <p className="text-sm text-muted mt-1">
        {isSuper
          ? "Create and manage all accounts."
          : "Create and manage trainee accounts."}
      </p>

      {/* Create */}
      <form
        onSubmit={submit}
        className="mt-6 rounded-xl border border-border bg-panel p-4 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end"
      >
        <label className="text-xs text-muted sm:col-span-1">
          User ID
          <input
            className={`mt-1 w-full ${input}`}
            value={userid}
            onChange={(e) => setUserid(e.target.value)}
            placeholder="raj.kumar"
            autoComplete="off"
          />
        </label>
        <label className="text-xs text-muted sm:col-span-1">
          Name
          <input
            className={`mt-1 w-full ${input}`}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Raj Kumar"
          />
        </label>
        <label className="text-xs text-muted sm:col-span-1">
          Temp password
          <input
            type="text"
            className={`mt-1 w-full ${input}`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="min 8 chars"
            autoComplete="off"
          />
        </label>
        <label className="text-xs text-muted sm:col-span-1">
          Role
          <select
            className={`mt-1 w-full ${input}`}
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            disabled={roleOptions.length === 1}
          >
            {roleOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={busy || !userid || !password}
          className="rounded-lg bg-accent text-black font-semibold py-2 disabled:opacity-50 sm:col-span-1"
        >
          {busy ? "Creating…" : "Create user"}
        </button>
      </form>
      {formErr && <p className="mt-2 text-sm text-danger">{formErr}</p>}
      {okMsg && <p className="mt-2 text-sm text-accent">{okMsg}</p>}

      {/* List */}
      <div className="mt-8 rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-panel text-muted text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left font-medium px-4 py-2">User ID</th>
              <th className="text-left font-medium px-4 py-2">Name</th>
              <th className="text-left font-medium px-4 py-2">Role</th>
              <th className="text-left font-medium px-4 py-2">Status</th>
              <th className="text-right font-medium px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr>
                <td className="px-4 py-4 text-muted" colSpan={5}>
                  Loading…
                </td>
              </tr>
            )}
            {rows?.length === 0 && (
              <tr>
                <td className="px-4 py-4 text-muted" colSpan={5}>
                  No users yet.
                </td>
              </tr>
            )}
            {rows?.map((r) => (
              <tr key={r.uid} className="border-t border-border">
                <td className="px-4 py-2">{r.userid}</td>
                <td className="px-4 py-2">{r.displayName}</td>
                <td className="px-4 py-2">{r.role}</td>
                <td className="px-4 py-2">
                  <span
                    className={
                      r.status === "disabled" ? "text-danger" : "text-accent"
                    }
                  >
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  {canManage(r) ? (
                    <span className="inline-flex gap-2">
                      <button
                        onClick={() => openAssign(r)}
                        className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-panel"
                      >
                        Agents
                      </button>
                      {r.role === "trainee" && (
                        <button
                          onClick={() => openLimits(r)}
                          className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-panel"
                        >
                          Limits
                        </button>
                      )}
                      <button
                        onClick={() => toggleStatus(r)}
                        className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-panel"
                      >
                        {r.status === "disabled" ? "Enable" : "Disable"}
                      </button>
                    </span>
                  ) : (
                    <span className="text-xs text-muted/50">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loadErr && <p className="mt-2 text-sm text-danger">{loadErr}</p>}

      {assignUid && (
        <div
          className="fixed inset-0 bg-black/50 grid place-items-center p-4 z-10"
          onClick={() => setAssignUid(null)}
        >
          <div
            className="bg-panel border border-border rounded-xl p-4 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold">Assign agents</h3>
            <p className="text-xs text-muted mt-1">
              Agents this user can train with (in addition to any from their groups).
            </p>
            <div className="mt-3 rounded-lg border border-border max-h-72 overflow-y-auto divide-y divide-border">
              {agents.map((a) => (
                <label
                  key={a.id}
                  className="flex items-center gap-2 px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={assignSet.has(a.id)}
                    onChange={() => toggleAssign(a.id)}
                  />
                  <span>{a.name || "(untitled)"}</span>
                  <span className="text-muted text-xs">{a.status}</span>
                </label>
              ))}
              {agents.length === 0 && (
                <div className="px-3 py-2 text-muted text-sm">No agents yet.</div>
              )}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setAssignUid(null)}
                className="rounded-md border border-border px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={saveAssign}
                className="rounded-md bg-accent text-black font-semibold px-3 py-1.5 text-sm"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {limitsRow && (
        <div
          className="fixed inset-0 bg-black/50 grid place-items-center p-4 z-10"
          onClick={() => setLimitsRow(null)}
        >
          <div
            className="bg-panel border border-border rounded-xl p-4 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold">Usage limits — {limitsRow.userid}</h3>
            <p className="text-xs text-muted mt-1">
              Minutes of interaction. <strong>0 = use the global default.</strong> The most
              restrictive of global / group / this user applies.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {([
                ["maxSessionMinutes", "Max session (min)"],
                ["perDayMin", "Per day (min)"],
                ["perWeekMin", "Per week (min)"],
                ["perMonthMin", "Per month (min)"],
              ] as const).map(([key, label]) => (
                <label key={key} className="text-xs text-muted">
                  {label}
                  <input
                    type="number"
                    min={0}
                    className={`mt-1 w-full ${input}`}
                    value={lf[key]}
                    onChange={(e) =>
                      setLf((p) => ({ ...p, [key]: Math.max(0, Number(e.target.value) || 0) }))
                    }
                  />
                </label>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setLimitsRow(null)}
                className="rounded-md border border-border px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={saveLimits}
                className="rounded-md bg-accent text-black font-semibold px-3 py-1.5 text-sm"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
