import { useEffect, useState } from "react";
import { useParams, Navigate, Outlet } from "react-router-dom";
import { checkMembership, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";
import LoadingState from "@/components/LoadingState";

/**
 * Wraps routes that require group membership.
 * Expects a `:groupId` URL param.
 * Returns 403 → redirects to /dashboard.
 */
export default function RequireGroupMember() {
  const { groupId } = useParams<{ groupId: string }>();
  const { user } = useAuth();
  const [status, setStatus] = useState<"loading" | "ok" | "denied">("loading");

  useEffect(() => {
    if (!groupId || !user) {
      setStatus("denied");
      return;
    }

    checkMembership(groupId)
      .then(() => setStatus("ok"))
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 403 || err.status === 401)) {
          setStatus("denied");
        } else {
          setStatus("denied");
        }
      });
  }, [groupId, user]);

  if (status === "loading") return <LoadingState message="Checking access…" />;

  if (status === "denied") {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
