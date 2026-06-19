import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const ROLE_LABEL: Record<string, string> = {
  superadmin: "Superadmin",
  admin: "Admin",
  trainee: "Trainee",
};

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        "block rounded-md px-3 py-2 text-sm " +
        (isActive ? "bg-panel text-white" : "text-muted hover:bg-panel/60")
      }
    >
      {label}
    </NavLink>
  );
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const staff = user?.role === "superadmin" || user?.role === "admin";
  const isSuper = user?.role === "superadmin";

  return (
    <div className="min-h-full flex flex-col">
      <header className="px-6 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold">Astra Voice Training</h1>
          {user && (
            <span className="text-[11px] uppercase tracking-wide text-accent border border-accent/40 bg-accent/10 rounded-full px-2 py-0.5">
              {ROLE_LABEL[user.role] ?? user.role}
            </span>
          )}
        </div>
        {user && (
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted">{user.displayName || user.userid}</span>
            <button
              onClick={() => logout()}
              className="rounded-md border border-border px-3 py-1.5 hover:bg-panel"
            >
              Sign out
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 flex min-h-0">
        <nav className="w-52 shrink-0 border-r border-border p-3 space-y-1 hidden sm:block">
          <NavItem to="/" label="Home" />
          <NavItem to="/my-agents" label="Train" />
          {staff && <NavItem to="/users" label="Users" />}
          {staff && <NavItem to="/groups" label="Groups" />}
          {isSuper && <NavItem to="/agents" label="Voice Agents" />}
          {staff && <NavItem to="/guided-questions" label="Guided Questions" />}
          {staff && <NavItem to="/dashboard" label="Analytics" />}
          {staff && <NavItem to="/errors" label="Error Logs" />}
          {isSuper && <NavItem to="/settings" label="Settings &amp; Limits" />}
        </nav>

        <main className="flex-1 min-w-0 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
