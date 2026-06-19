import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { DEFAULT_SETTINGS, getGlobalSettings, saveGlobalSettings } from "../../lib/settings";
import { humanizeError } from "../../lib/errors";
import type { GlobalSettings } from "@avtp/shared";

const input =
  "rounded-lg bg-bg border border-border px-3 py-2 outline-none focus:border-accent text-sm w-full";

function NumField({
  label,
  hint,
  value,
  onChange,
  unit,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (n: number) => void;
  unit?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-muted">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="number"
          min={0}
          className={input}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        />
        {unit && <span className="text-xs text-muted shrink-0">{unit}</span>}
      </div>
      {hint && <span className="block text-[11px] text-muted mt-1">{hint}</span>}
    </label>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const [s, setS] = useState<GlobalSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    getGlobalSettings()
      .then(setS)
      .catch((e) => setErr(humanizeError(e)))
      .finally(() => setLoading(false));
  }, []);

  const setNum = (k: keyof GlobalSettings, v: number) => setS((p) => ({ ...p, [k]: v }));
  const setLimit = (k: keyof GlobalSettings["defaultUsageLimits"], v: number) =>
    setS((p) => ({ ...p, defaultUsageLimits: { ...p.defaultUsageLimits, [k]: v } }));

  const save = async () => {
    setBusy(true);
    setErr(null);
    setOk(false);
    try {
      await saveGlobalSettings(s, user!.uid);
      setOk(true);
    } catch (e) {
      setErr(humanizeError(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="max-w-3xl mx-auto px-6 py-8 text-muted text-sm">Loading…</div>;

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Settings &amp; limits</h2>
        <p className="text-sm text-muted mt-1">
          Platform-wide restrictions. <strong>0 = unlimited / off.</strong> Per-trainee and
          per-group overrides (Users / Groups) tighten these — the most restrictive wins.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-panel p-4 space-y-4">
        <h3 className="text-sm font-medium">Session restrictions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <NumField
            label="Max session length"
            unit="min"
            hint="A single session auto-ends at this length."
            value={s.maxSessionMinutes}
            onChange={(v) => setNum("maxSessionMinutes", v)}
          />
          <NumField
            label="Idle timeout"
            unit="sec"
            hint="Auto-end after no speech/messages for this long."
            value={s.idleTimeoutSec}
            onChange={(v) => setNum("idleTimeoutSec", v)}
          />
          <NumField
            label="Max concurrent — per trainee"
            unit="sessions"
            hint="Live sessions one trainee can run at once."
            value={s.maxConcurrentSessionsPerUser}
            onChange={(v) => setNum("maxConcurrentSessionsPerUser", v)}
          />
          <NumField
            label="Max concurrent — whole platform"
            unit="sessions"
            hint="Total live sessions across ALL users at once (caps xAI load/cost)."
            value={s.maxConcurrentSessionsTotal}
            onChange={(v) => setNum("maxConcurrentSessionsTotal", v)}
          />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-panel p-4 space-y-4">
        <h3 className="text-sm font-medium">Default usage limits (per trainee)</h3>
        <p className="text-[11px] text-muted">
          Minutes of interaction allowed in each period. Applied to every trainee unless a
          tighter per-user or per-group limit is set.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <NumField
            label="Per day"
            unit="min"
            value={s.defaultUsageLimits.perDayMin || 0}
            onChange={(v) => setLimit("perDayMin", v)}
          />
          <NumField
            label="Per week"
            unit="min"
            value={s.defaultUsageLimits.perWeekMin || 0}
            onChange={(v) => setLimit("perWeekMin", v)}
          />
          <NumField
            label="Per month"
            unit="min"
            value={s.defaultUsageLimits.perMonthMin || 0}
            onChange={(v) => setLimit("perMonthMin", v)}
          />
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-accent text-black font-semibold px-5 py-2 text-sm disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save settings"}
        </button>
        {ok && <span className="text-sm text-accent">Saved.</span>}
        {err && <span className="text-sm text-danger">{err}</span>}
        {s.updatedAt && (
          <span className="text-xs text-muted ml-auto">
            Last updated {new Date(s.updatedAt).toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}
