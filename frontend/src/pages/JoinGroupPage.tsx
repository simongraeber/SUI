import { useEffect, useState } from "react";
import { useParams, useSearchParams, useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import PageTransition from "@/components/PageTransition";
import { joinGroup, ApiError } from "@/lib/api";

function JoinGroupPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const code = searchParams.get("code") ?? "";

  const [status, setStatus] = useState<"loading" | "success" | "error" | "already">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!groupId || !code) {
      setStatus("error");
      setErrorMsg("Invalid invite link.");
      return;
    }

    joinGroup(groupId, code)
      .then(() => {
        setStatus("success");
        setTimeout(() => navigate(`/group/${groupId}`, { replace: true }), 1500);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 409) {
          setStatus("already");
          setTimeout(() => navigate(`/group/${groupId}`, { replace: true }), 1500);
        } else {
          setStatus("error");
          setErrorMsg(err instanceof ApiError ? err.message : "Something went wrong");
        }
      });
  }, [groupId, code, navigate]);

  return (
    <PageTransition className="max-w-md mx-auto px-4 py-16 text-center">
      <Card>
        <CardContent className="py-8">
          {status === "loading" && (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="size-6 animate-spin text-primary" />
              <p className="text-muted-foreground">Joining group…</p>
            </div>
          )}
          {status === "success" && (
            <p className="text-green-600 font-medium">Successfully joined! Redirecting…</p>
          )}
          {status === "already" && (
            <p className="text-muted-foreground">You're already a member. Redirecting…</p>
          )}
          {status === "error" && (
            <div className="flex flex-col items-center gap-4">
              <p className="text-destructive font-medium">{errorMsg}</p>
              <Button variant="outline" asChild>
                <Link to="/dashboard">Back to Dashboard</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </PageTransition>
  );
}

export default JoinGroupPage;
