/**
 * @fileoverview React Router root for YamBot web app.
 * Purpose: Public auth routes + protected shell with toggleable left sidebar.
 * Downstream: All pages; AuthProvider gates session.
 */

import { useEffect, useState } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import { AppSidebar } from "./components/AppSidebar.jsx";
import { LoginPage } from "./pages/LoginPage.jsx";
import { RegisterPage } from "./pages/RegisterPage.jsx";
import { ChatsPage } from "./pages/ChatsPage.jsx";
import { ChatDetailPage } from "./pages/ChatDetailPage.jsx";
import { SettingsPage } from "./pages/SettingsPage.jsx";
import { AgentsPage } from "./pages/AgentsPage.jsx";
import { AgentEditPage } from "./pages/AgentEditPage.jsx";
import { SystemPage } from "./pages/SystemPage.jsx";

const COLLAPSE_KEY = "yambot.sidebar.collapsed";

/**
 * Requires an authenticated user before rendering child routes.
 */
function ProtectedLayout() {
  const { user, loading } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  // Why: close drawer when resizing up to desktop so it does not stay stuck open.
  useEffect(() => {
    function onResize() {
      if (window.matchMedia("(min-width: 1024px)").matches) setMobileOpen(false);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (loading) {
    return <div className="p-6 text-sm text-teal-900/70">Loading session…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="flex min-h-full w-full overflow-x-hidden">
      <AppSidebar
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar — hamburger opens the left drawer */}
        <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-teal-100 bg-white/95 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur lg:hidden">
          <button
            type="button"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-teal-100 bg-white text-lg font-bold"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            ☰
          </button>
          <div className="min-w-0 flex-1 truncate text-sm font-bold tracking-tight">YamBot</div>
        </div>

        <main className="min-w-0 flex-1 overflow-x-hidden">{<Outlet />}</main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<ChatsPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/new" element={<AgentEditPage />} />
          <Route path="/agents/:agentId" element={<AgentEditPage />} />
          <Route path="/chats/:chatId" element={<ChatDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/system" element={<SystemPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
