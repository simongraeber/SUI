import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider } from "./lib/AuthContext";
import RequireAuth from "./components/RequireAuth";
import RequireGroupMember from "./components/RequireGroupMember";
import LoadingState from "./components/LoadingState";
import ErrorBoundary from "./components/ErrorBoundary";
import Footer from "./components/Footer";
import { Toaster } from "@/components/ui/sonner";
import "./App.css";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

import HomePage from "./pages/HomePage";

const LoginPage = lazy(() => import("./pages/LoginPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const GroupPage = lazy(() => import("./pages/GroupPage"));
const JoinGroupPage = lazy(() => import("./pages/JoinGroupPage"));
const LeaderboardPage = lazy(() => import("./pages/LeaderboardPage"));
const PlayerPage = lazy(() => import("./pages/MemberPage"));
const GamePage = lazy(() => import("./pages/GamePage"));
const TournamentPage = lazy(() => import("./pages/TournamentPage"));
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
            <ErrorBoundary>
            <Suspense fallback={<LoadingState />}>
              <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/imprint" element={<ImprintPage />} />
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/terms" element={<TermsPage />} />

              {/* Public tournament page — no auth required */}
              <Route path="/tournament/:slug" element={<TournamentPage />} />

              <Route element={<RequireAuth />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/group/:groupId/join" element={<JoinGroupPage />} />
                <Route path="/group/:groupId" element={<GroupPage />} />
                <Route path="/leaderboard/:groupId" element={<LeaderboardPage />} />
                <Route path="/group/:groupId/member/:memberId" element={<PlayerPage />} />

                <Route element={<RequireGroupMember />}>
                  <Route path="/game/:groupId" element={<GamePage />} />
                </Route>

                {/* Tournament match game — auth only, no group membership required */}
                <Route path="/tournament/:slug/match/:matchId/game" element={<GamePage />} />
              </Route>

              <Route path="*" element={<NotFoundPage />} />
            </Routes>
            </Suspense>
            </ErrorBoundary>
          </main>
          <Footer />
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
