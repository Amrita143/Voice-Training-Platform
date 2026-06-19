import { useAuth } from "../auth/AuthContext";
import type { Role } from "@avtp/shared";

const AREAS: Record<Role, { title: string; phase: string }[]> = {
  superadmin: [
    { title: "Users", phase: "available" },
    { title: "Voice Agents", phase: "Phase 2" },
    { title: "Groups", phase: "Phase 1" },
    { title: "Guided Questions", phase: "Phase 4" },
    { title: "Analytics", phase: "Phase 6" },
    { title: "Usage & Settings", phase: "Phase 7" },
  ],
  admin: [
    { title: "Users (trainees)", phase: "available" },
    { title: "Groups", phase: "Phase 1" },
    { title: "Guided Questions", phase: "Phase 4" },
    { title: "Analytics", phase: "Phase 6" },
  ],
  trainee: [
    { title: "My Voice Agents", phase: "Phase 3" },
    { title: "Guided Questions", phase: "Phase 4" },
  ],
};

export default function Home() {
  const { user } = useAuth();
  if (!user) return null;
  const areas = AREAS[user.role] ?? [];

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <h2 className="text-2xl font-semibold">
        Welcome{user.displayName ? `, ${user.displayName}` : ""}
      </h2>
      <p className="mt-1 text-sm text-muted">
        You're signed in. Sections light up as each phase ships.
      </p>

      <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {areas.map((a) => (
          <div
            key={a.title}
            className="rounded-xl border border-border bg-panel px-4 py-4"
          >
            <div className="font-medium">{a.title}</div>
            <div
              className={
                "text-xs mt-1 " +
                (a.phase === "available" ? "text-accent" : "text-muted")
              }
            >
              {a.phase === "available" ? "Available now" : `Coming in ${a.phase}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
