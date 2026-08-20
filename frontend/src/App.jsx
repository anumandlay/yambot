/**
 * @fileoverview React Router root for YamBot web app.
 * Purpose: Public auth routes + protected chat/settings shell.
 * Downstream: All pages; AuthProvider gates session.
 */

import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import { AppHeader } from "./components/AppHeader.jsx";
import { LoginPage } from "./pages/LoginPage.jsx";
import { RegisterPage } from "./pages/RegisterPage.jsx";
import { ChatsPage } from "./pages/ChatsPage.jsx";
import { ChatDetailPage } from "./pages/ChatDetailPage.jsx";
import { SettingsPage } from "./pages/SettingsPage.jsx";

/**
 * Requires an authenticated user before rendering child routes.
 */
function ProtectedLayout() {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="p-6 text-sm text-teal-900/70">Loading session…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;
  return (
    <div className="flex min-h-full w-full flex-col overflow-x-hidden">
      <AppHeader />
      <Outlet />
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
          <Route path="/chats/:chatId" element={<ChatDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
