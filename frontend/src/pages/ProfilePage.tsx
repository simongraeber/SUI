import { useRef, useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Upload, LogOut, Gamepad2, Trophy, Goal, Pencil } from "lucide-react";
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
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

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

  useEffect(() => {
    setNameDraft(user?.name ?? "");
  }, [user?.name]);

  const startNameEdit = useCallback(() => {
    setNameDraft(user?.name ?? "");
    setNameError(null);
    setIsEditingName(true);
  }, [user?.name]);

  const cancelNameEdit = useCallback(() => {
    setNameDraft(user?.name ?? "");
    setNameError(null);
    setIsEditingName(false);
  }, [user?.name]);

  const saveName = useCallback(async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameError("Name cannot be empty.");
      return;
    }
    if (trimmed.length > 80) {
      setNameError("Name must be 80 characters or fewer.");
      return;
    }
    if (trimmed === (user?.name ?? "")) {
      setIsEditingName(false);
      setNameError(null);
      return;
    }

    setNameSaving(true);
    setNameError(null);
    try {
      await updateMe({ name: trimmed });
      await refreshUser();
      setIsEditingName(false);
    } catch {
      setNameError("Could not update name. Please try again.");
    } finally {
      setNameSaving(false);
    }
  }, [nameDraft, refreshUser, user?.name]);

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

        <motion.div layout className="mx-auto max-w-sm">
          <AnimatePresence mode="wait" initial={false}>
            {isEditingName ? (
              <motion.div
                key="name-edit"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                <Card className="mb-2">
                  <CardContent className="flex flex-col gap-3 py-5">
                    <Input
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void saveName()}
                      maxLength={80}
                      disabled={nameSaving}
                      aria-label="Display name"
                      placeholder="Display name..."
                    />
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="outline" onClick={cancelNameEdit} disabled={nameSaving}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={() => void saveName()} disabled={nameSaving || !nameDraft.trim()}>
                        {nameSaving ? "Saving..." : "Save Name"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
                {nameError && (
                  <p className="text-sm text-red-500">{nameError}</p>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="name-read"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="flex items-center justify-center gap-2"
              >
                <h2 className="text-xl font-semibold">{user?.name ?? "Player"}</h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={startNameEdit}
                  aria-label="Edit display name"
                >
                  <Pencil className="size-4" />
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
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
