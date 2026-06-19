import type { ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import AppShell from "./components/AppShell";
import Login from "./routes/Login";
import ChangePassword from "./routes/ChangePassword";
import Home from "./routes/Home";
import Users from "./routes/admin/Users";
import Groups from "./routes/admin/Groups";
import GuidedQuestions from "./routes/admin/GuidedQuestions";
import Dashboard from "./routes/admin/Dashboard";
import SessionDetail from "./routes/admin/SessionDetail";
import Agents from "./routes/admin/Agents";
import AgentEditor from "./routes/admin/AgentEditor";
import Settings from "./routes/admin/Settings";
import ErrorLogs from "./routes/admin/ErrorLogs";
import MyAgents from "./routes/trainee/MyAgents";
import Train from "./routes/trainee/Train";
import type { Role } from "@avtp/shared";

function Loading() {
  return (
    <div className="min-h-full grid place-items-center text-muted text-sm">
      Loading…
    </div>
  );
}

function RequireAuth({
  children,
  allowChange = false,
}: {
  children: ReactNode;
  allowChange?: boolean;
}) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword && !allowChange)
    return <Navigate to="/change-password" replace />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return null;
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="/login"
            element={
              <PublicOnly>
                <Login />
              </PublicOnly>
            }
          />
          <Route
            path="/change-password"
            element={
              <RequireAuth allowChange>
                <ChangePassword />
              </RequireAuth>
            }
          />
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route path="/" element={<Home />} />
            <Route path="/my-agents" element={<MyAgents />} />
            <Route path="/train/:id" element={<Train />} />
            <Route
              path="/users"
              element={
                <RequireRole roles={["superadmin", "admin"]}>
                  <Users />
                </RequireRole>
              }
            />
            <Route
              path="/groups"
              element={
                <RequireRole roles={["superadmin", "admin"]}>
                  <Groups />
                </RequireRole>
              }
            />
            <Route
              path="/guided-questions"
              element={
                <RequireRole roles={["superadmin", "admin"]}>
                  <GuidedQuestions />
                </RequireRole>
              }
            />
            <Route
              path="/dashboard"
              element={
                <RequireRole roles={["superadmin", "admin"]}>
                  <Dashboard />
                </RequireRole>
              }
            />
            <Route
              path="/dashboard/:id"
              element={
                <RequireRole roles={["superadmin", "admin"]}>
                  <SessionDetail />
                </RequireRole>
              }
            />
            <Route
              path="/agents"
              element={
                <RequireRole roles={["superadmin"]}>
                  <Agents />
                </RequireRole>
              }
            />
            <Route
              path="/agents/new"
              element={
                <RequireRole roles={["superadmin"]}>
                  <AgentEditor />
                </RequireRole>
              }
            />
            <Route
              path="/agents/:id"
              element={
                <RequireRole roles={["superadmin"]}>
                  <AgentEditor />
                </RequireRole>
              }
            />
            <Route
              path="/settings"
              element={
                <RequireRole roles={["superadmin"]}>
                  <Settings />
                </RequireRole>
              }
            />
            <Route
              path="/errors"
              element={
                <RequireRole roles={["superadmin", "admin"]}>
                  <ErrorLogs />
                </RequireRole>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
