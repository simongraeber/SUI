import { useRef, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import LinkButton from "@/components/LinkButton";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ArrowLeft, Upload, Loader2, LogOut, Gamepad2, Trophy, Goal } from "lucide-react";
import PageTransition from "@/components/PageTransition";
import { cardSlideUp, staggerContainer } from "@/lib/animations";
import { useAuth } from "@/lib/AuthContext";
import {
  generateAIImage,
  updateMe,
  resolveImageUrl,
  listMyGroups,
  getGroupStats,
} from "@/lib/api";

/** Resize an image file to fit within maxDim and return a compressed File. */
async function resizeImage(file: File, maxDim = 1024, quality = 0.8): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
    type: "image/jpeg",
  });
}

function ProfilePage() {
  const { user, refreshUser, logout } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);

  const [preview, setPreview] = useState<string | null>(null);
  const [aiPreview, setAiPreview] = useState<string | null>(null);
  const [aiImageId, setAiImageId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset so the same file can be re-selected
    e.target.value = "";
    let finalFile: File;
    try {
      finalFile = await resizeImage(file);
    } catch {
      finalFile = file;
    }
    cancelledRef.current = false;
    setPreview(URL.createObjectURL(finalFile));
    setAiPreview(null);
    setAiImageId(null);
    setError(null);
    setDialogOpen(true);

    setGenerating(true);
    try {
      const { blob, imageId } = await generateAIImage(finalFile);
      if (cancelledRef.current) return;
      const url = URL.createObjectURL(blob);
      setAiPreview(url);
      setAiImageId(imageId);
    } catch (err) {
      if (!cancelledRef.current) {
        setError(err instanceof Error ? err.message : "AI generation failed");
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleCancel = () => {
    cancelledRef.current = true;
    setDialogOpen(false);
    setPreview(null);
    setAiPreview(null);
    setAiImageId(null);
    setGenerating(false);
    setError(null);
  };

  const handleSaveAsProfile = async () => {
    if (!aiImageId) return;
    setSaving(true);
    setError(null);
    try {
      const imageUrl = `/api/v1/images/${aiImageId}`;
      await updateMe({ image_url: imageUrl });
      await refreshUser();
      setDialogOpen(false);
      setPreview(null);
      setAiPreview(null);
      setAiImageId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save image");
    } finally {
      setSaving(false);
    }
  };

  const displayImage = resolveImageUrl(user?.image_url);
  const joined = user?.created_at
    ? new Date(user.created_at).toLocaleDateString()
    : "—";

  return (
    <PageTransition className="max-w-3xl mx-auto px-4 py-8 text-center">
      <h1 className="text-3xl font-bold mb-2">Profile</h1>
      <p className="text-muted-foreground mb-8">Your stats and account info.</p>

      {/* Avatar / image area */}
      <div className="mb-8">
        <div
          className="relative mx-auto mb-4 cursor-pointer group w-40 h-40"
          onClick={() => fileInputRef.current?.click()}
        >
          <Avatar className="h-40 w-40 border-2 border-muted">
            <AvatarImage src={displayImage ?? undefined} alt="Profile" />
            <AvatarFallback className="text-3xl">
              {user?.name?.charAt(0)?.toUpperCase() ?? "?"}
            </AvatarFallback>
          </Avatar>
          <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <Upload className="size-6 text-white" />
          </div>
          {/* Tiny persistent upload badge */}
          <div className="absolute bottom-1 right-1 w-7 h-7 bg-primary text-primary-foreground rounded-full flex items-center justify-center shadow group-hover:scale-110 transition-transform z-10 pointer-events-none">
            <Upload className="size-3.5" />
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={handleFileSelect}
        />

        <h2 className="text-xl font-semibold">{user?.name ?? "Player"}</h2>
        <p className="text-sm text-muted-foreground">{user?.email}</p>
        <p className="text-muted-foreground">Joined: {joined}</p>
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => { if (!open) handleCancel(); }}
      >
        <DialogContent className="max-w-sm text-center">
          <DialogHeader className="items-center">
            <DialogTitle>AI Profile Picture</DialogTitle>
            <DialogDescription>
              {generating ? "Creating your AI profile picture…" : "Save this as your new profile picture?"}
            </DialogDescription>
          </DialogHeader>

          {/* Avatar with AI shimmer while generating */}
          <div className="relative mx-auto w-44 h-44 flex items-center justify-center">
            <div
              className="absolute inset-0 ai-shimmer-track ai-shimmer-glow pointer-events-none transition-opacity duration-700"
              style={{
                "--shimmer-radius": "50%",
                opacity: generating ? 0.6 : 0,
              } as React.CSSProperties}
            >
              <div className="ai-shimmer ai-shimmer-spin" />
            </div>
            <Avatar className="h-40 w-40 border-2 border-muted relative z-10">
              <AvatarImage src={(aiPreview ?? preview) ?? undefined} alt="Profile preview" />
              <AvatarFallback className="text-3xl">
                {user?.name?.charAt(0)?.toUpperCase() ?? "?"}
              </AvatarFallback>
            </Avatar>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <DialogFooter className="flex-row gap-3 sm:justify-center">
            {!generating && aiPreview && (
              <Button
                onClick={handleSaveAsProfile}
                disabled={saving}
                className="flex-1 gap-2 bg-gradient-to-br from-[var(--cta-bg-from)] to-[var(--cta-bg-to)] text-white shadow-lg shadow-primary/30 hover:shadow-primary/45"
              >
                {saving && <Loader2 className="size-4 animate-spin" />}
                {saving ? "Saving…" : "Save"}
              </Button>
            )}
            {!generating && !aiPreview && error && (
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => fileInputRef.current?.click()}
              >
                Try again
              </Button>
            )}
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleCancel}
              disabled={saving}
            >
              {generating ? "Cancel" : "Discard"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
        <LinkButton variant="outline" to="/dashboard">
          <ArrowLeft className="size-4" />
          Back to Dashboard
        </LinkButton>
        <Button variant="destructive" onClick={() => logout()}>
          <LogOut className="size-4" />
          Log Out
        </Button>
      </div>
    </PageTransition>
  );
}

export default ProfilePage;
