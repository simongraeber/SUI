import { useRef, useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Upload, LogOut, Gamepad2, Trophy, Goal } from "lucide-react";
import UserAvatar from "@/components/UserAvatar";
import PageTransition from "@/components/PageTransition";
import ImageUploadDialog, { type ImageUploadDialogHandle } from "@/components/ImageUploadDialog";
import { cardSlideUp, staggerContainer } from "@/lib/animations";
import { useAuth } from "@/lib/AuthContext";
import {
  generateAIImage,
  uploadProfileImage,
  updateMe,
  listMyGroups,
  getGroupStats,
} from "@/lib/api";

function ProfilePage() {
  const { user, refreshUser, logout } = useAuth();
  const uploadRef = useRef<ImageUploadDialogHandle>(null);

  // Aggregated stats across all groups
  const [totalGames, setTotalGames] = useState(0);
  const [totalWins, setTotalWins] = useState(0);
  const [totalGoals, setTotalGoals] = useState(0);
  const [statsLoading, setStatsLoading] = useState(true);

  // Fetch and aggregate stats from all groups
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const groups = await listMyGroups();
        let games = 0;
        let wins = 0;
        let goals = 0;

        const results = await Promise.allSettled(
          groups.map((g) => getGroupStats(g.id))
        );

        for (const result of results) {
          if (result.status !== "fulfilled") continue;
          const stats = result.value;
          const me = stats.players.find((p) => p.user_id === user.id);
          if (!me) continue;
          games += me.games_played;
          wins += me.wins;
          goals += me.goals_scored;
        }

        setTotalGames(games);
        setTotalWins(wins);
        setTotalGoals(goals);
      } catch {
        // silently fail — stats just stay at 0
      } finally {
        setStatsLoading(false);
      }
    })();
  }, [user]);

  const handleSaveOriginal = useCallback(async (file: File) => {
    const { image_url } = await uploadProfileImage(file);
    await updateMe({ image_url });
    await refreshUser();
  }, [refreshUser]);
  const handleGenerate = useCallback((file: File) => generateAIImage(file), []);
  const handleSaveAI = useCallback(async (imageId: string) => {
    await updateMe({ image_url: `/api/v1/images/${imageId}` });
    await refreshUser();
  }, [refreshUser]);

  const joined = user?.created_at
    ? new Date(user.created_at).toLocaleDateString()
    : "—";

  return (
    <PageTransition className="max-w-3xl mx-auto px-4 py-8 text-center">
      <Link to="/dashboard" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 w-fit">
        <ArrowLeft className="size-4" />
        Dashboard
      </Link>
      <div className="text-center mb-6">
        <h1 className="text-3xl font-bold">Profile</h1>
        <p className="text-muted-foreground text-sm">Your stats and account info.</p>
      </div>

      {/* Avatar / image area */}
      <div className="mb-8">
        <div
          onClick={() => uploadRef.current?.pickFile()}
          className="relative mx-auto mb-4 cursor-pointer group w-fit"
        >
          <UserAvatar
            name={user?.name}
            imageUrl={user?.image_url}
            className="h-40 w-40 border-2 border-muted hover:border-primary transition-colors cursor-pointer"
            fallbackClassName="text-3xl"
          />
          <Button
            aria-label="Upload profile picture"
            className="absolute bottom-1 right-1 w-8 h-8 bg-primary text-primary-foreground rounded-full p-0 flex items-center justify-center shadow group-hover:scale-110 transition-transform"
          >
            <Upload className="size-4" />
          </Button>
        </div>

        <ImageUploadDialog
          ref={uploadRef}
          variant="profile"
          name={user?.name ?? "Player"}
          onSaveOriginal={handleSaveOriginal}
          onGenerate={handleGenerate}
          onSaveAI={handleSaveAI}
        />

        <h2 className="text-xl font-semibold">{user?.name ?? "Player"}</h2>
        <p className="text-sm text-muted-foreground">{user?.email}</p>
        <p className="text-muted-foreground">Joined: {joined}</p>
      </div>

      {/* Stats */}
      {statsLoading ? (
        <div className="grid grid-cols-3 gap-3 mb-8 max-w-md mx-auto">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[106px] w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <motion.div
          className="grid grid-cols-3 gap-3 mb-8 max-w-md mx-auto"
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          <motion.div variants={cardSlideUp}>
            <Card>
              <CardContent className="pt-5 pb-4 text-center">
                <Gamepad2 className="size-5 mx-auto mb-1.5 text-blue-500" />
                <p className="text-xs text-muted-foreground">Games</p>
                <p className="text-xl font-bold">{totalGames}</p>
              </CardContent>
            </Card>
          </motion.div>
          <motion.div variants={cardSlideUp}>
            <Card>
              <CardContent className="pt-5 pb-4 text-center">
                <Trophy className="size-5 mx-auto mb-1.5 text-yellow-500" />
                <p className="text-xs text-muted-foreground">Wins</p>
                <p className="text-xl font-bold">{totalWins}</p>
              </CardContent>
            </Card>
          </motion.div>
          <motion.div variants={cardSlideUp}>
            <Card>
              <CardContent className="pt-5 pb-4 text-center">
                <Goal className="size-5 mx-auto mb-1.5 text-red-500" />
                <p className="text-xs text-muted-foreground">Goals</p>
                <p className="text-xl font-bold">{totalGoals}</p>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}

      <div className="flex justify-center gap-3">
        <Button variant="destructive" onClick={() => logout()}>
          <LogOut className="size-4" />
          Log Out
        </Button>
      </div>
    </PageTransition>
  );
}

export default ProfilePage;
