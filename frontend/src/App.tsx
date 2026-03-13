import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider } from "./lib/AuthContext";
import RequireAuth from "./components/RequireAuth";
import RequireGroupMember from "./components/RequireGroupMember";
import Footer from "./components/Footer";
import { Toaster } from "@/components/ui/sonner";
import "./App.css";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

/* ── Eagerly loaded (landing page — critical for FCP) ── */
import HomePage from "./pages/HomePage";

/* ── Lazy-loaded pages (code-split into separate chunks) ── */
const LoginPage = lazy(() => import("./pages/LoginPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const GroupPage = lazy(() => import("./pages/GroupPage"));
const JoinGroupPage = lazy(() => import("./pages/JoinGroupPage"));
const LeaderboardPage = lazy(() => import("./pages/LeaderboardPage"));
const PlayerPage = lazy(() => import("./pages/PlayerPage"));
const GamePage = lazy(() => import("./pages/GamePage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));
const ImprintPage = lazy(() => import("./pages/ImprintPage"));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage"));
const TermsPage = lazy(() => import("./pages/TermsPage"));

function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <AuthProvider>
        <Toaster position="top-right" richColors />
        <div className="flex flex-col min-h-screen bg-[var(--footer-bg)]">
          <main className="flex-1">
            <Suspense>
              <Routes>
              {/* Public */}
              <Route path="/" element={<HomePage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/imprint" element={<ImprintPage />} />
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/terms" element={<TermsPage />} />

              {/* Authenticated */}
              <Route element={<RequireAuth />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/group/:groupId/join" element={<JoinGroupPage />} />

                {/* Group-member-only routes */}
                <Route element={<RequireGroupMember />}>
                  <Route path="/group/:groupId" element={<GroupPage />} />
                  <Route path="/game/:groupId" element={<GamePage />} />
                  <Route path="/leaderboard/:groupId" element={<LeaderboardPage />} />
                  <Route path="/group/:groupId/member/:memberId" element={<PlayerPage />} />
                </Route>
              </Route>

              <Route path="*" element={<NotFoundPage />} />
            </Routes>
            </Suspense>
          </main>
          <Footer />
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
