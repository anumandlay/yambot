/**
 * @fileoverview React Router root for YamBot web app.
 * Purpose: Public auth routes + protected shell with toggleable left sidebar.
 * Downstream: All pages; AuthProvider gates session.
 */

import { useEffect, useState } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import { HelpProvider } from "./context/HelpContext.jsx";
import { AppSidebar } from "./components/AppSidebar.jsx";
import { HelpToggle } from "./components/HelpToggle.jsx";
import { LoginPage } from "./pages/LoginPage.jsx";
import { RegisterPage } from "./pages/RegisterPage.jsx";
import { ChatsPage } from "./pages/ChatsPage.jsx";
import { ChatDetailPage } from "./pages/ChatDetailPage.jsx";
import { SettingsLayout } from "./pages/SettingsLayout.jsx";
import { SettingsPage } from "./pages/SettingsPage.jsx";
import { SettingsOpenAiPage } from "./pages/SettingsOpenAiPage.jsx";
import { SettingsLlmProfilesPage } from "./pages/SettingsLlmProfilesPage.jsx";
import { AgentsPage } from "./pages/AgentsPage.jsx";
import { AgentEditPage } from "./pages/AgentEditPage.jsx";
import { SystemPage } from "./pages/SystemPage.jsx";
import { LiveWallPage } from "./pages/LiveWallPage.jsx";
import { GoalsPage } from "./pages/GoalsPage.jsx";
import { GoalEditPage } from "./pages/GoalEditPage.jsx";
import { GovernancePage } from "./pages/GovernancePage.jsx";
import { PoliciesPage } from "./pages/PoliciesPage.jsx";
import { WorkforcePage } from "./pages/WorkforcePage.jsx";
import { OperationsPage } from "./pages/OperationsPage.jsx";
import { CompanyPage } from "./pages/CompanyPage.jsx";
import { SkillsPage } from "./pages/SkillsPage.jsx";
import { SkillEditPage } from "./pages/SkillEditPage.jsx";
import { HowToPage } from "./pages/HowToPage.jsx";
import { AdminLoginPage } from "./pages/AdminLoginPage.jsx";
import { AdminUsersPage } from "./pages/AdminUsersPage.jsx";
import { WalletPage } from "./pages/WalletPage.jsx";
import { QueuesPage } from "./pages/QueuesPage.jsx";
import { TicketDetailPage } from "./pages/TicketDetailPage.jsx";
import { PortalTicketPage } from "./pages/PortalTicketPage.jsx";
import { DealsPage } from "./pages/DealsPage.jsx";
import { InvoicesPage } from "./pages/InvoicesPage.jsx";
import { StartPage } from "./pages/StartPage.jsx";
import { BusinessSetupPage } from "./pages/BusinessSetupPage.jsx";
import { AgentActionsPage } from "./pages/AgentActionsPage.jsx";

const COLLAPSE_KEY = "yambot.sidebar.collapsed";

/**
 * Requires an authenticated user before rendering child routes.
 */
function ProtectedLayout() {
  const { user, loading, logout, refresh } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loadingSlow, setLoadingSlow] = useState(false);
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

  useEffect(() => {
    if (!loading) {
      setLoadingSlow(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setLoadingSlow(true), 8000);
    return () => window.clearTimeout(timer);
  }, [loading]);

  if (loading && !user) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-sm text-teal-900/70">
        <p>Loading session…</p>
        {loadingSlow ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="max-w-sm text-xs text-teal-900/60">
              Session restore is taking longer than expected. You can retry or sign in again.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                className="min-h-10 rounded-xl border border-teal-200 px-3 font-semibold text-teal-800"
                onClick={() => void refresh()}
              >
                Retry
              </button>
              <button
                type="button"
                className="min-h-10 rounded-xl bg-teal-700 px-3 font-semibold text-white"
                onClick={() => {
                  logout();
                  window.location.href = "/login";
                }}
              >
                Sign in again
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="flex h-dvh max-h-dvh min-h-0 w-full overflow-hidden">
      <AppSidebar
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
          <HelpToggle compact />
        </div>

        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">{<Outlet />}</main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <HelpProvider>
        <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/portal/ticket/:token" element={<PortalTicketPage />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/agent-actions" element={<AgentActionsPage />} />
          <Route path="/start" element={<StartPage />} />
          <Route path="/business" element={<BusinessSetupPage />} />
          <Route path="/" element={<ChatsPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/new" element={<AgentEditPage />} />
          <Route path="/agents/:agentId" element={<AgentEditPage />} />
          <Route path="/goals" element={<GoalsPage />} />
          <Route path="/goals/new" element={<GoalEditPage />} />
          <Route path="/goals/:goalId" element={<GoalEditPage />} />
          <Route path="/governance" element={<GovernancePage />} />
          <Route path="/policies" element={<PoliciesPage />} />
          <Route path="/workforce" element={<WorkforcePage />} />
          <Route path="/operations" element={<OperationsPage />} />
          <Route path="/queues" element={<QueuesPage />} />
          <Route path="/tickets/:ticketId" element={<TicketDetailPage />} />
          <Route path="/deals" element={<DealsPage />} />
          <Route path="/invoices" element={<InvoicesPage />} />
          <Route path="/company" element={<CompanyPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/skills/new" element={<SkillEditPage />} />
          <Route path="/skills/:skillId" element={<SkillEditPage />} />
          <Route path="/how-to" element={<HowToPage />} />
          <Route path="/live" element={<LiveWallPage />} />
          <Route path="/chats/:chatId" element={<ChatDetailPage />} />
          <Route path="/settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="llm" replace />} />
            <Route path="llm" element={<SettingsPage />} />
            <Route path="llms" element={<SettingsLlmProfilesPage />} />
            <Route path="openai" element={<SettingsOpenAiPage />} />
          </Route>
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/system" element={<SystemPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HelpProvider>
    </AuthProvider>
  );
}
