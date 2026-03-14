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

  const [preview, setPreview] = useState<string | null>(null);
  const [aiPreview, setAiPreview] = useState<string | null>(null);
  const [aiImageId, setAiImageId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    let finalFile: File;
    try {
      finalFile = await resizeImage(file);
    } catch {
      finalFile = file;
    }
    setPreview(URL.createObjectURL(finalFile));
    setAiPreview(null);
    setError(null);

    setGenerating(true);
    try {
      const { blob, imageId } = await generateAIImage(finalFile);
      const url = URL.createObjectURL(blob);
      setAiPreview(url);
      setAiImageId(imageId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveAsProfile = async () => {
    if (!aiImageId) return;
    setSaving(true);
    setError(null);
    try {
      // Store the persistent image URL (served by the backend)
      const imageUrl = `/api/v1/images/${aiImageId}`;
      await updateMe({ image_url: imageUrl });
      await refreshUser();
      setPreview(null);
      setAiPreview(null);
      setAiImageId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save image");
    } finally {
      setSaving(false);
    }
  };

  const displayImage = aiPreview ?? preview ?? resolveImageUrl(user?.image_url);
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

      {/* Generating spinner below avatar */}
      {generating && (
        <div className="mb-6 flex flex-col items-center gap-2">
          <Loader2 className="size-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Generating AI Image…</p>
        </div>
      )}

      <Dialog
        open={!!aiPreview}
        onOpenChange={(open) => {
          if (!open) {
            setAiPreview(null);
            setPreview(null);
          }
        }}
      >
        <DialogContent className="max-w-sm text-center">
          <DialogHeader className="items-center">
            <DialogTitle>AI Profile Picture</DialogTitle>
            <DialogDescription>
              Save this as your new profile picture?
            </DialogDescription>
          </DialogHeader>
          {aiPreview && (
            <Avatar className="h-40 w-40 mx-auto border-2 border-muted">
              <AvatarImage src={aiPreview} alt="AI generated" />
              <AvatarFallback>AI</AvatarFallback>
            </Avatar>
          )}
          <DialogFooter className="flex-row gap-3 sm:justify-center">
            <Button
              onClick={handleSaveAsProfile}
              disabled={saving}
              className="flex-1 gap-2 bg-gradient-to-br from-[var(--cta-bg-from)] to-[var(--cta-bg-to)] text-white shadow-lg shadow-primary/30 hover:shadow-primary/45"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setAiPreview(null);
                setPreview(null);
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {error && <p className="text-sm text-red-500 mb-4">{error}</p>}

      {/* Stats */}
      {statsLoading ? (
        <div className="grid grid-cols-3 gap-3 mb-8 max-w-md mx-auto">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[90px] w-full rounded-xl" />
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
