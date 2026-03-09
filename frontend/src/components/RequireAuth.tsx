import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import LoadingState from "@/components/LoadingState";

/**
 * Wraps routes that require an authenticated user.
 * Redirects to /login while loading or if not authenticated,
 * preserving the original URL so the user lands there after login.
 */
export default function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingState />;

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
