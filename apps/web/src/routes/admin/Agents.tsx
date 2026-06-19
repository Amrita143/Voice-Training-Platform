import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { listAgents, deleteAgent, type AgentWithId } from "../../lib/agents";
import { humanizeError } from "../../lib/errors";

const STATUS_COLOR: Record<string, string> = {
  published: "text-accent",
  draft: "text-muted",
  archived: "text-danger",
};

export default function Agents() {
  const nav = useNavigate();
  const [rows, setRows] = useState<AgentWithId[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reload = async () => {
    setErr(null);
    try {
      setRows(await listAgents());
    } catch (e) {
      setErr(humanizeError(e));
    }
  };
  useEffect(() => {
    reload();
  }, []);

  const remove = async (a: AgentWithId) => {
    if (!confirm(`Delete agent “${a.name || a.id}”? This cannot be undone.`))
      return;
    try {
      await deleteAgent(a.id);
      await reload();
    } catch (e) {
      setErr(humanizeError(e));
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Voice Agents</h2>
          <p className="text-sm text-muted mt-1">
            Configure a trainer per process — prompt, knowledge base, tools, voice.
          </p>
        </div>
        <Link
          to="/agents/new"
          className="rounded-lg bg-accent text-black font-semibold px-4 py-2 text-sm"
        >
          New agent
        </Link>
      </div>

      <div className="mt-6 rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-panel text-muted text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left font-medium px-4 py-2">Name</th>
              <th className="text-left font-medium px-4 py-2">Status</th>
              <th className="text-left font-medium px-4 py-2">Voice</th>
              <th className="text-left font-medium px-4 py-2">KB</th>
              <th className="text-left font-medium px-4 py-2">Tools</th>
              <th className="text-right font-medium px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr>
                <td className="px-4 py-4 text-muted" colSpan={6}>
                  Loading…
                </td>
              </tr>
            )}
            {rows?.length === 0 && (
              <tr>
                <td className="px-4 py-4 text-muted" colSpan={6}>
                  No agents yet — create your first one.
                </td>
              </tr>
            )}
            {rows?.map((a) => (
              <tr
                key={a.id}
                className="border-t border-border hover:bg-panel/40 cursor-pointer"
                onClick={() => nav(`/agents/${a.id}`)}
              >
                <td className="px-4 py-2 font-medium">{a.name || "(untitled)"}</td>
                <td className="px-4 py-2">
                  <span className={STATUS_COLOR[a.status] ?? "text-muted"}>
                    {a.status}
                  </span>
                </td>
                <td className="px-4 py-2">{a.voices?.default}</td>
                <td className="px-4 py-2">
                  {a.knowledgeBase?.enabled ? "on" : "off"}
                </td>
                <td className="px-4 py-2">{a.tools?.length ?? 0}</td>
                <td
                  className="px-4 py-2 text-right"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Link
                    to={`/agents/${a.id}`}
                    className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-panel mr-2"
                  >
                    Edit
                  </Link>
                  <button
                    onClick={() => remove(a)}
                    className="rounded-md border border-border px-2.5 py-1 text-xs text-danger hover:bg-panel"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {err && <p className="mt-2 text-sm text-danger">{err}</p>}
    </div>
  );
}
