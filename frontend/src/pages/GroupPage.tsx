import { useEffect, useState, useTransition } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import LinkButton from "@/components/LinkButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import UserAvatar from "@/components/UserAvatar";
import { ArrowLeft, Users, Gamepad2, Copy, Check, LogOut, BarChart3 } from "lucide-react";
import { motion } from "framer-motion";
import PageTransition from "@/components/PageTransition";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerContainer, fadeUp } from "@/lib/animations";
import { getGroup, leaveGroup, type GroupDetail } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";

function GroupPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);

  useEffect(() => {
    if (!groupId) return;
    getGroup(groupId)
      .then(setGroup)
      .catch(() => navigate("/dashboard", { replace: true }))
      .finally(() => setLoading(false));
  }, [groupId, navigate]);

  const handleCopyInvite = async () => {
    if (!group) return;
    const url = `${window.location.origin}/group/${group.id}/join?code=${group.invite_code}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLeave = async () => {
    if (!groupId) return;
    await leaveGroup(groupId);
    navigate("/dashboard", { replace: true });
  };

  if (loading) return (
    <PageTransition className="max-w-3xl mx-auto px-4 py-8 text-center">
      <h1 className="text-3xl font-bold mb-2">
        <Skeleton className="h-[1em] w-48 rounded-md inline-block align-middle" />
      </h1>
      <p className="text-muted-foreground mb-6">
        <Skeleton className="h-[1em] w-28 rounded-md inline-block align-middle" />
      </p>

      <div className="flex flex-wrap justify-center gap-3 mb-8">
        <Skeleton className="h-10 w-36 rounded-lg" />
        <Skeleton className="h-10 w-40 rounded-lg" />
        <Skeleton className="h-10 w-44 rounded-lg" />
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center justify-center gap-2">
            <Users className="size-5" />
            Members
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <li key={i}>
                <Skeleton className="h-[54px] w-full rounded-md" />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-center gap-3">
        <Skeleton className="h-10 w-48 rounded-lg" />
      </div>
    </PageTransition>
  );

  if (!group) return null;

  const isOwner = user?.id === group.created_by;

  return (
    <PageTransition className="max-w-3xl mx-auto px-4 py-8 text-center">
      <h1 className="text-3xl font-bold mb-2">{group.name}</h1>
      <p className="text-muted-foreground mb-6">
        {group.member_count} member{group.member_count !== 1 ? "s" : ""}
      </p>

      {/* Quick actions */}
      <div className="flex flex-wrap justify-center gap-3 mb-8">
        <LinkButton to={`/game/${groupId}`}>
          <Gamepad2 className="size-4 mr-1" />
          Play Game
        </LinkButton>
        <LinkButton variant="secondary" to={`/leaderboard/${groupId}`}>
          <BarChart3 className="size-4 mr-1" />
          Leaderboard
        </LinkButton>
        <Button variant="outline" onClick={handleCopyInvite}>
          {copied ? <Check className="size-4 mr-1" /> : <Copy className="size-4 mr-1" />}
          {copied ? "Copied!" : "Copy Invite Link"}
        </Button>
      </div>

      {/* Members */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center justify-center gap-2">
            <Users className="size-5" />
            Members
          </CardTitle>
        </CardHeader>
        <CardContent>
          {group.members.length === 0 ? (
            <p className="text-muted-foreground italic">No members to display.</p>
          ) : (
            <motion.ul
              className="space-y-3"
              variants={staggerContainer}
              initial="hidden"
              animate="show"
            >
              {[...group.members].sort((a, b) => a.name.localeCompare(b.name)).map((m) => {
                const isNavigating = isPending && pendingMemberId === m.user_id;
                return (
                  <motion.li key={m.user_id} variants={fadeUp}>
                    <div
                      onClick={() => {
                        setPendingMemberId(m.user_id);
                        startTransition(() => navigate(`/group/${groupId}/member/${m.user_id}`));
                      }}
                      className={`flex items-center gap-3 rounded-md border px-3 py-2 hover:bg-muted/50 transition-colors cursor-pointer ${isNavigating ? "animate-pulse" : ""}`}
                    >
                      <UserAvatar name={m.name} imageUrl={m.image_url} className="h-8 w-8" fallbackClassName="text-xs" />
                      <div className="text-left flex-1 min-w-0">
                        <p className="font-medium truncate">{m.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                      </div>
                      {m.user_id === group.created_by && (
                        <Badge variant="secondary" className="text-xs">
                          Owner
                        </Badge>
                      )}
                    </div>
                  </motion.li>
                );
              })}
            </motion.ul>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-center gap-3">
        <LinkButton variant="outline" to="/dashboard">
          <ArrowLeft className="size-4" />
          Back to Dashboard
        </LinkButton>
        {!isOwner && (
          <Button variant="destructive" size="sm" onClick={handleLeave}>
            <LogOut className="size-4 mr-1" />
            Leave Group
          </Button>
        )}
      </div>
    </PageTransition>
  );
}

export default GroupPage;
