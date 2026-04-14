import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Trophy,
  Users,
  Copy,
  Check,
  Play,
  Trash2,
  ArrowLeft,
  Settings2,
  LogIn,
  Upload,
} from "lucide-react";

import PageTransition from "@/components/PageTransition";
import BracketView from "@/components/BracketView";
import { TeamPlayerManager, RoundSettings } from "@/components/TournamentHelpers";
import UserAvatar from "@/components/UserAvatar";
import ImageUploadDialog, { type ImageUploadDialogHandle } from "@/components/ImageUploadDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerContainer, fadeUp } from "@/lib/animations";
import { useAuth } from "@/lib/AuthContext";
import {
  getTournament,
  registerTeam,
  removeTeam,
  startTournament,
  startMatchGame,
  listMyGroups,
  getGroup,
  uploadTeamImage,
  generateTeamAIImage,
  generateTeamImage,
  saveTeamImageUrl,
  resolveImageUrl,
  type TournamentDetail,
  type TournamentMatch,
  type GroupMember,
} from "@/lib/api";

/* ── Status badge ───────────────────────────────────────────────────────── */
const statusVariant: Record<string, "default" | "secondary" | "outline"> = {
  registration: "secondary",
  active: "default",
  completed: "outline",
};
const statusLabel: Record<string, string> = {
  registration: "Registering",
  active: "In Progress",
  completed: "Completed",
};

/* ── Main page ──────────────────────────────────────────────────────────── */
export default function TournamentPage() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [tournament, setTournament] = useState<TournamentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [registerLoading, setRegisterLoading] = useState(false);
  const [startLoading, setStartLoading] = useState(false);
  const [removingTeam, setRemovingTeam] = useState<string | null>(null);

  // Shared image upload dialog
  const imageDialogRef = useRef<ImageUploadDialogHandle>(null);
  const activeTeamIdRef = useRef<string | null>(null);
  const [teamImageChoiceOpen, setTeamImageChoiceOpen] = useState<null | string>(null); // teamId or null

  // Group data for player suggestions
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);

  // Track team IDs created by guest (non-logged-in) users in this session
  const [guestTeamIds, setGuestTeamIds] = useState<Set<string>>(new Set());

  const isAdmin = !!user && tournament?.admin_user_id === user.id;

  useEffect(() => {
    if (!slug) return;
    getTournament(slug)
      .then(setTournament)
      .catch((err: unknown) => {
        const status = (err as { status?: number })?.status;
        if (status === 404) {
          setLoadError("Tournament not found.");
        } else {
          setLoadError("Could not load tournament. Please try again.");
        }
      })
      .finally(() => setLoading(false));
  }, [slug, navigate]);

  // Auto-refresh bracket for active tournaments
  useEffect(() => {
    if (!slug || !tournament || tournament.status !== "active") return;
    const interval = setInterval(() => {
      getTournament(slug).then(setTournament).catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, [slug, tournament?.status]);

  // Load player suggestions from all groups the user belongs to
  useEffect(() => {
    if (!user) { setGroupMembers([]); return; }
    (async () => {
      try {
        const groups = await listMyGroups();
        const seen = new Map<string, GroupMember>();
        await Promise.all(groups.map(async (g) => {
          try {
            const detail = await getGroup(g.id);
            for (const m of detail.members) {
              if (!seen.has(m.user_id)) seen.set(m.user_id, m);
            }
          } catch { /* ignore */ }
        }));
        setGroupMembers(Array.from(seen.values()));
      } catch { /* ignore */ }
    })();
  }, [user]);

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegister = async () => {
    if (!slug || !teamName.trim()) return;
    setRegisterLoading(true);
    try {
      const newTeam = await registerTeam(slug, teamName.trim(), user?.id ?? null);
      if (!user) {
        setGuestTeamIds((prev) => new Set(prev).add(newTeam.id));
      }
      const updated = await getTournament(slug);
      setTournament(updated);
      setTeamName("");
      toast.success("Team registered!");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Registration failed";
      toast.error(msg);
    } finally {
      setRegisterLoading(false);
    }
  };

  const handleRemoveTeam = async (teamId: string) => {
    if (!slug) return;
    setRemovingTeam(teamId);
    try {
      await removeTeam(slug, teamId);
      const updated = await getTournament(slug);
      setTournament(updated);
      toast.success("Team removed");
    } catch {
      toast.error("Failed to remove team");
    } finally {
      setRemovingTeam(null);
    }
  };

  const handleStart = async () => {
    if (!slug) return;
    setStartLoading(true);
    try {
      await startTournament(slug);
      // Re-fetch to ensure all bracket data is fully loaded
      const refreshed = await getTournament(slug);
      setTournament(refreshed);
      toast.success("Tournament started! Bracket generated.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to start";
      toast.error(msg);
    } finally {
      setStartLoading(false);
    }
  };

  const handleStartMatch = async (match: TournamentMatch) => {
    if (!slug) return;
    try {
      await startMatchGame(slug, match.id);
      // refresh so game_id appears on match card
      getTournament(slug).then(setTournament).catch(() => {});
      navigate(`/tournament/${slug}/match/${match.id}/game`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to start match";
      toast.error(msg);
    }
  };

  const handleTeamUploadClick = (teamId: string) => {
    setTeamImageChoiceOpen(teamId);
  };

  // Called when user picks an option in the modal
  const handleTeamImageChoice = (choice: "generate" | "upload") => {
    if (!teamImageChoiceOpen) return;
    activeTeamIdRef.current = teamImageChoiceOpen;
    setTeamImageChoiceOpen(null);
    if (choice === "generate") {
      if (!slug) return;
      imageDialogRef.current?.startExternalGeneration(
        generateTeamImage(slug, activeTeamIdRef.current)
      );
    } else {
      imageDialogRef.current?.pickFile();
    }
  };

  const handleTeamSaveOriginal = useCallback(async (file: File) => {
    if (!slug || !activeTeamIdRef.current) return;
    await uploadTeamImage(slug, activeTeamIdRef.current, file);
    const updated = await getTournament(slug);
    setTournament(updated);
  }, [slug]);

  const handleTeamGenerate = useCallback(async (file: File) => {
    if (!slug || !activeTeamIdRef.current) throw new Error("No team selected");
    return generateTeamAIImage(slug, activeTeamIdRef.current, file);
  }, [slug]);

  const handleTeamSaveAI = useCallback(async (imageId: string) => {
    if (!slug || !activeTeamIdRef.current) return;
    await saveTeamImageUrl(slug, activeTeamIdRef.current, imageId);
    const updated = await getTournament(slug);
    setTournament(updated);
  }, [slug]);

  if (loading) {
    return (
      <PageTransition className="max-w-5xl mx-auto px-4 py-8">
        <Skeleton className="h-10 w-64 mb-2" />
        <Skeleton className="h-5 w-32 mb-8" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </PageTransition>
    );
  }

  if (loadError) {
    return (
      <PageTransition className="max-w-5xl mx-auto px-4 py-8">
        {user && (
          <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
            <ArrowLeft className="size-4" />
            Dashboard
          </Link>
        )}
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-muted/30 h-64 gap-3 text-muted-foreground">
          <Trophy className="size-10 opacity-30" />
          <p className="font-medium">{loadError}</p>
          <Link to="/" className="text-xs underline underline-offset-2 hover:text-foreground">Go home</Link>
        </div>
      </PageTransition>
    );
  }

  if (!tournament) return null;

  const alreadyRegistered =
    user &&
    tournament.status === "registration" &&
    tournament.teams.some((t) => t.user_id === user.id);

  return (
    <PageTransition className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="size-4" />
        Dashboard
      </Link>
      <div className="text-center mb-6">
        <h1 className="text-3xl font-bold flex items-center justify-center gap-2">
          <Trophy className="size-7 text-yellow-500" />
          {tournament.name}
        </h1>
      </div>

      <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-2 mb-6">
        <motion.div variants={fadeUp} className="flex justify-center gap-2 flex-wrap">
          <Badge variant={statusVariant[tournament.status]}>{statusLabel[tournament.status]}</Badge>
          <Button variant="outline" size="sm" onClick={handleCopyLink}>
            {copied ? <Check className="size-4 mr-1" /> : <Copy className="size-4 mr-1" />}
            {copied ? "Copied!" : "Share link"}
          </Button>
        </motion.div>


      </motion.div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {/* ── Left: teams + registration ── */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="size-4" />
                Teams
                <Badge variant="outline" className="ml-auto text-xs">{tournament.teams.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {tournament.teams.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No teams yet — be the first to register!</p>
              )}

              {/* Shared image upload dialog for all teams */}
              <ImageUploadDialog
                ref={imageDialogRef}
                variant="team"
                name={tournament.teams.find(t => t.id === activeTeamIdRef.current)?.name ?? tournament.name}
                onSaveOriginal={handleTeamSaveOriginal}
                onGenerate={handleTeamGenerate}
                onSaveAI={handleTeamSaveAI}
              />

              <motion.div className="space-y-3" variants={staggerContainer} initial="hidden" animate="show">
              <AnimatePresence initial={false}>
                {tournament.teams.map((team) => {
                  const canManageImage = isAdmin || team.user_id === user?.id;
                  return (
                  <motion.div
                    key={team.id}
                    variants={fadeUp}
                    exit={{ opacity: 0, x: -8, height: 0 }}
                    className="rounded-md border overflow-hidden"
                  >
                    {/* Team image filling top of card */}
                    {team.image_url ? (
                      <div className="relative group" style={{ aspectRatio: "16/9" }}>
                        <img src={resolveImageUrl(team.image_url) ?? ""} alt={team.name} className="w-full h-full object-cover" />
                        {canManageImage && (
                          <button
                            type="button"
                            className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
                            onClick={() => handleTeamUploadClick(team.id)}
                          >
                            <Upload className="size-5 text-white" />
                          </button>
                        )}
                      </div>
                    ) : canManageImage ? (
                        <button
                          type="button"
                          className="block w-full relative group bg-secondary flex items-center justify-center cursor-pointer"
                          style={{ aspectRatio: "16/9" }}
                          onClick={() => handleTeamUploadClick(team.id)}
                        >
                          <div className="text-muted-foreground flex flex-col items-center gap-1 group-hover:text-foreground transition-colors">
                            <Upload className="size-5" />
                            <span className="text-[11px]">Add image</span>
                          </div>
                        </button>
                    ) : null}

                    {/* Team name, actions, members */}
                    <div className="px-3 py-2">
                      <div className="flex items-center gap-2 group">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{team.name}</p>
                          {team.players.length > 0 && (
                            <p className="text-[11px] text-muted-foreground">{team.players.length} player{team.players.length !== 1 ? "s" : ""}</p>
                          )}
                        </div>
                        {isAdmin && tournament.status === "registration" && (
                          <Button
                            size="icon" variant="ghost"
                            className="size-7 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 text-destructive hover:text-destructive"
                            onClick={() => handleRemoveTeam(team.id)}
                            disabled={removingTeam === team.id}
                            aria-label={`Remove team ${team.name}`}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </div>
                      {tournament.status === "registration" ? (
                        <TeamPlayerManager
                          slug={slug!}
                          team={team}
                          isAdmin={isAdmin}
                          currentUserId={user?.id}
                          isOwnedByGuest={guestTeamIds.has(team.id)}
                          groupMembers={groupMembers}
                          onUpdated={() => getTournament(slug!).then(setTournament)}
                        />
                      ) : (
                        <div className="mt-1.5 space-y-1">
                          {team.players.map((p) => (
                            <div key={p.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <UserAvatar name={p.name} imageUrl={p.user_image_url} className="size-4 shrink-0" fallbackClassName="text-[7px]" />
                              <span className="truncate">{p.name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
                })}
              </AnimatePresence>
              </motion.div>

              {/* Team image upload choice dialog */}
              <Dialog open={!!teamImageChoiceOpen} onOpenChange={open => !open && setTeamImageChoiceOpen(null)}>
                <DialogContent className="max-w-xs text-center">
                  <div className="mb-3 font-semibold text-lg">Team Image</div>
                  <div className="mb-5 text-muted-foreground text-sm whitespace-pre-line">
                    How would you like to set your team image?
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button className="w-full" variant="outline" onClick={() => handleTeamImageChoice("generate")}>Generate from Player Photos</Button>
                    <Button className="w-full" onClick={() => handleTeamImageChoice("upload")}>Upload Image</Button>
                    <Button className="w-full" variant="ghost" onClick={() => setTeamImageChoiceOpen(null)}>Cancel</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>

          {/* Register form */}
          {tournament.status === "registration" && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {alreadyRegistered ? "You're registered!" : "Register your team"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {alreadyRegistered ? (
                  <p className="text-sm text-muted-foreground">Your team is already in. Share the link to invite others!</p>
                ) : (
                  <div className="space-y-3">
                    {!user && (
                      <div className="flex items-center gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                        <LogIn className="size-3.5 shrink-0" />
                        <span>
                          <Link to="/login" className="underline underline-offset-2">Sign in</Link>{" "}
                          to link your account — or just enter a team name to join as a guest.
                        </span>
                      </div>
                    )}
                    <Input
                      placeholder="Team name"
                      value={teamName}
                      onChange={(e) => setTeamName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleRegister()}
                      disabled={registerLoading}
                    />
                    <Button className="w-full" onClick={handleRegister} disabled={registerLoading || !teamName.trim()}>
                      {registerLoading ? "Registering…" : "Join Tournament"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Admin panel */}
          {isAdmin && (
            <Card className="border-dashed">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2 text-muted-foreground">
                  <Settings2 className="size-4" />
                  Admin
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Start tournament button — only during registration */}
                {tournament.status === "registration" && (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Once all teams have joined, start the tournament to generate the bracket.
                    </p>
                    <Button
                      className="w-full"
                      onClick={handleStart}
                      disabled={startLoading || tournament.teams.length < 2}
                    >
                      <Play className="size-4 mr-2" />
                      {startLoading ? "Starting…" : "Start Tournament"}
                    </Button>
                    {tournament.teams.length < 2 && (
                      <p className="text-xs text-muted-foreground text-center">Need at least 2 teams</p>
                    )}
                  </>
                )}

                {/* Per-round goal settings — available when bracket exists */}
                {tournament.num_rounds != null && tournament.num_rounds > 0 && (
                  <RoundSettings
                    tournament={tournament}
                    slug={slug!}
                    onUpdated={(t) => setTournament(t)}
                  />
                )}

              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Right: bracket ── */}
        <div className="sm:col-span-2">
          {tournament.status === "registration" && (
            <Card className="h-64">
              <CardContent className="h-full flex flex-col items-center justify-center text-muted-foreground">
                <Trophy className="size-8 mb-2 text-muted-foreground/50" />
                <p className="font-medium">Bracket will appear once the tournament starts</p>
                <p className="text-xs mt-1">{tournament.teams.length} team{tournament.teams.length !== 1 ? "s" : ""} registered</p>
              </CardContent>
            </Card>
          )}

          {(tournament.status === "active" || tournament.status === "completed") && tournament.num_rounds !== null && (
            <div>
              {tournament.status === "completed" && (
                <div className="flex items-center justify-center gap-3 rounded-xl bg-yellow-500/10 border border-yellow-500/30 p-4 mb-6">
                  <Trophy className="size-6 text-yellow-500" />
                  <div>
                    <p className="font-semibold text-sm">Tournament Champion</p>
                    <p className="text-lg font-bold">
                      {(() => {
                        const finalMatch = tournament.matches.find((m) => m.round === tournament.num_rounds);
                        if (!finalMatch?.winner_id) return "TBD";
                        const winner = finalMatch.team_a?.id === finalMatch.winner_id ? finalMatch.team_a : finalMatch.team_b;
                        return winner?.name ?? "TBD";
                      })()}
                    </p>
                  </div>
                </div>
              )}

              {isAdmin && tournament.status === "active" && (
                <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
                  <Settings2 className="size-3.5" />
                  Click "Start match" on any ready bracket card to launch a live game
                </p>
              )}

              <BracketView
                matches={tournament.matches}
                numRounds={tournament.num_rounds}
                slug={slug ?? ""}
                onStartMatch={handleStartMatch}
                isAdmin={isAdmin}
              />
            </div>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
