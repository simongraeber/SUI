import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { revealY } from "@/lib/animations";
import { FormDots } from "@/components/FormDots";
import { eloColor } from "@/lib/utils";
import { useAuth } from "@/lib/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import LinkButton from "@/components/LinkButton";
import UserAvatar from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Pencil, Shield, Swords, TrendingUp } from "lucide-react";
import PageTransition from "@/components/PageTransition";
import {
  getGroup,
  getGroupStats,
  listPlayerGames,
  type PlayerStats,
  type GameResponse,
  type GroupMember,
} from "@/lib/api";

/* ── Stat row helper ── */
function StatRow({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex justify-between items-center py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium ${color ?? ""}`}>{value}</span>
    </div>
  );
}

function PlayerPage() {
  const { groupId, memberId: userId } = useParams<{ groupId: string; memberId: string }>();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const isOwnProfile = currentUser?.id === userId;
  const [player, setPlayer] = useState<PlayerStats | null>(null);
  const [member, setMember] = useState<GroupMember | null>(null);
  const [games, setGames] = useState<GameResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!groupId || !userId) return;

    Promise.all([
      getGroup(groupId),
      getGroupStats(groupId),
      listPlayerGames(groupId, userId),
    ])
      .then(([group, stats, playerGames]) => {
        const found = stats.players.find((p) => p.user_id === userId);
        setPlayer(found ?? null);
        setMember(group.members.find((m) => m.user_id === userId) ?? null);
        setGames(playerGames);
      })
      .catch(() => navigate(`/group/${groupId}`, { replace: true }))
      .finally(() => setLoading(false));
  }, [groupId, userId, navigate]);

  if (loading) {
    return (
      <PageTransition className="max-w-lg mx-auto px-4 py-8">
        {/* Avatar + name + elo skeleton */}
        <div className="flex flex-col items-center mb-6">
          <Skeleton className="h-28 w-28 rounded-full mb-3" />
          <h1 className="text-lg font-bold">
            <Skeleton className="h-[1em] w-32 rounded-md inline-block align-middle" />
          </h1>
          <Card className="mt-3 px-6 py-3">
            <Skeleton className="h-9 w-28" />
          </Card>
        </div>
        {/* Stats card skeleton */}
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <Skeleton className="h-5 w-28" />
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-12" />
              </div>
            ))}
          </CardContent>
        </Card>
        {/* Recent games skeleton */}
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-md" />
            ))}
          </CardContent>
        </Card>
      </PageTransition>
    );
  }
  if (!player && !member) {
    return (
      <PageTransition className="max-w-md mx-auto px-4 py-16 text-center">
        <p className="text-muted-foreground mb-4">Player not found.</p>
        <LinkButton variant="outline" to={`/group/${groupId}`}>
          <ArrowLeft className="size-4" /> Back
        </LinkButton>
      </PageTransition>
    );
  }

  /* Player exists in group but has no games yet */
  if (!player) {
    return (
      <PageTransition className="max-w-lg mx-auto px-4 py-8">
        <div className="flex flex-col items-center py-8">
          <div
            className={`relative${isOwnProfile ? " cursor-pointer group" : ""}`}
            onClick={isOwnProfile ? () => navigate("/profile") : undefined}
          >
            <UserAvatar
              name={member!.name}
              imageUrl={member!.image_url}
              className="h-28 w-28 mb-3"
              fallbackClassName="text-3xl"
            />
            {isOwnProfile && (
              <span className="absolute bottom-2 right-0 bg-primary text-primary-foreground rounded-full p-1 shadow group-hover:scale-110 transition-transform">
                <Pencil className="size-3.5" />
              </span>
            )}
          </div>
          <h1 className="text-lg font-bold text-center">{member!.name}</h1>
          <p className="text-sm text-muted-foreground mt-2">No games played yet.</p>
        </div>

        <div className="flex justify-center mt-4">
          <LinkButton variant="outline" to={`/group/${groupId}`}>
            <ArrowLeft className="size-4" />
            Back
          </LinkButton>
        </div>
      </PageTransition>
    );
  }

  const gdColor =
    player.goal_diff > 0
      ? "text-green-600 dark:text-green-400"
      : player.goal_diff < 0
        ? "text-red-500"
        : undefined;

  return (
    <PageTransition className="max-w-lg mx-auto px-4 py-8">
      {/* ── Header ── */}
      <div className="flex flex-col items-center mb-6">
        <div
          className={`relative${isOwnProfile ? " cursor-pointer group" : ""}`}
          onClick={isOwnProfile ? () => navigate("/profile") : undefined}
        >
          <UserAvatar
              name={player.name}
              imageUrl={player.image_url}
              className="h-28 w-28 mb-3"
              fallbackClassName="text-3xl"
            />
          {isOwnProfile && (
            <span className="absolute bottom-2 right-0 bg-primary text-primary-foreground rounded-full p-1 shadow group-hover:scale-110 transition-transform">
              <Pencil className="size-3.5" />
            </span>
          )}
        </div>
        <h1 className="text-lg font-bold text-center">{player.name}</h1>
        {player.provisional && (
          <motion.div
            variants={revealY}
            initial="hidden"
            animate="show"
            style={{ originY: 0 }}
          >
            <Badge variant="secondary" className="text-[10px] mt-1">
              Provisional
            </Badge>
          </motion.div>
        )}
        <Card className="mt-3 px-6 py-3">
          <div className="flex items-center justify-center gap-2">
            <TrendingUp className={`size-5 ${eloColor(player.elo)}`} />
            <p className={`text-3xl font-bold text-center ${eloColor(player.elo)}`}>
              {player.elo}{" "}
              <span className="text-base font-normal text-muted-foreground">Elo</span>
            </p>
          </div>
        </Card>
      </div>

      {/* ── Stats card ── */}
      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="size-4" />
            Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <StatRow label="Games Played" value={player.games_played} />
          <StatRow label="Wins" value={player.wins} color="text-green-600" />
          <StatRow label="Losses" value={player.losses} color="text-red-500" />
          <Separator className="my-2" />
          <StatRow label="Win Rate" value={`${player.win_rate}%`} />
          <StatRow label="Goals Scored" value={player.goals_scored} />
          <StatRow label="Goals Conceded" value={player.goals_conceded} />
          <StatRow label="Goal Difference" value={`${player.goal_diff > 0 ? "+" : ""}${player.goal_diff}`} color={gdColor} />
          <StatRow label="Goals / Game" value={player.goals_per_game} />
          {player.own_goals > 0 && (
            <StatRow label="Own Goals" value={player.own_goals} color="text-red-500" />
          )}
          <Separator className="my-2" />
          <div className="flex justify-between items-center py-1.5">
            <span className="text-sm text-muted-foreground">Form</span>
            <FormDots form={player.form} size="md" />
          </div>
          {player.streak && (
            <StatRow
              label="Current Streak"
              value={`${player.streak.type}${player.streak.count}`}
              color={player.streak.type === "W" ? "text-green-600" : player.streak.type === "L" ? "text-red-500" : undefined}
            />
          )}
        </CardContent>
      </Card>

      {/* ── Recent games ── */}
      {games.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Swords className="size-4" />
              Recent Games
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {games.map((game) => {
                const playerSide = game.players.find(
                  (p) => p.user_id === userId,
                )?.side;
                const won = game.winner === playerSide;

                const resultLabel = won ? "W" : "L";
                const resultColor = won
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";

                const teammates = game.players
                  .filter((p) => p.side === playerSide && p.user_id !== userId)
                  .map((p) => p.name);
                const opponents = game.players
                  .filter((p) => p.side !== playerSide)
                  .map((p) => p.name);

                const playerGoals = game.goals.filter(
                  (g) => g.scored_by === userId && !g.friendly_fire,
                ).length;

                const date = new Date(game.created_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                });

                return (
                  <li
                    key={game.id}
                    className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
                  >
                    <span
                      className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${resultColor}`}
                    >
                      {resultLabel}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">
                        {game.score_a} – {game.score_b}
                        {playerGoals > 0 && (
                          <span className="text-muted-foreground font-normal ml-1.5">
                            ({playerGoals} goal{playerGoals !== 1 ? "s" : ""})
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {teammates.length > 0 ? `with ${teammates.join(", ")} ` : ""}
                        vs {opponents.join(", ")}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {date}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── Navigation ── */}
      <div className="flex justify-center">
        <LinkButton variant="outline" to={`/group/${groupId}`}>
          <ArrowLeft className="size-4" />
          Back
        </LinkButton>
      </div>
    </PageTransition>
  );
}

export default PlayerPage;
