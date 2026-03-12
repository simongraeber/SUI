import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ArrowLeft, Users, Gamepad2, Copy, Check, LogOut, BarChart3 } from "lucide-react";
import PageTransition from "@/components/PageTransition";
import LoadingState from "@/components/LoadingState";
import { getGroup, leaveGroup, resolveImageUrl, type GroupDetail } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";

function GroupPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

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

  if (loading) return <LoadingState message="Loading group…" />;

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
        <Button asChild>
          <Link to={`/game/${groupId}`}>
            <Gamepad2 className="size-4 mr-1" />
            Play Game
          </Link>
        </Button>
        <Button variant="secondary" asChild>
          <Link to={`/leaderboard/${groupId}`}>
            <BarChart3 className="size-4 mr-1" />
            Leaderboard
          </Link>
        </Button>
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
            <ul className="space-y-3">
              {[...group.members].sort((a, b) => a.name.localeCompare(b.name)).map((m) => (
                <li key={m.user_id}>
                  <Link
                    to={`/group/${groupId}/member/${m.user_id}`}
                    className="flex items-center gap-3 rounded-md border px-3 py-2 hover:bg-muted/50 transition-colors"
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={resolveImageUrl(m.image_url) ?? undefined} alt={m.name} />
                      <AvatarFallback className="text-xs">
                        {m.name?.charAt(0)?.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="text-left flex-1 min-w-0">
                      <p className="font-medium truncate">{m.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                    </div>
                    {m.user_id === group.created_by && (
                      <Badge variant="secondary" className="text-xs">
                        Owner
                      </Badge>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-center gap-3">
        <Button variant="outline" asChild>
          <Link to="/dashboard">
            <ArrowLeft className="size-4" />
            Dashboard
          </Link>
        </Button>
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
