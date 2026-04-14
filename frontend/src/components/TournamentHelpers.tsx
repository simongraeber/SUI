import { useState, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { X } from "lucide-react";

import UserAvatar from "@/components/UserAvatar";
import { roundLabel } from "@/components/BracketView";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover";
import {
  addTeamPlayer,
  removeTeamPlayer,
  updateRoundSettings,
  type TournamentDetail,
  type TournamentTeam,
  type GroupMember,
} from "@/lib/api";

/* ── Member suggestion dropdown ─────────────────────────────────────────── */
function MemberSuggestionItems({
  query,
  members,
  onSelect,
}: {
  query: string;
  members: GroupMember[];
  onSelect: (m: GroupMember) => void;
}) {
  const filtered = useMemo(() => {
    if (!query.trim()) return [];
    const lq = query.toLowerCase();
    return members.filter((m) => m.name.toLowerCase().includes(lq) || m.email.toLowerCase().includes(lq)).slice(0, 6);
  }, [query, members]);

  if (!filtered.length) return null;
  return (
    <>
      {filtered.map((m) => (
        <button
          key={m.user_id}
          type="button"
          className="flex items-center gap-2 w-full px-2 py-1.5 text-left text-xs hover:bg-muted transition-colors"
          onMouseDown={(e) => { e.preventDefault(); onSelect(m); }}
        >
          <UserAvatar name={m.name} imageUrl={m.image_url} className="size-5 shrink-0" />
          <span className="font-medium truncate">{m.name}</span>
          <span className="text-muted-foreground truncate ml-auto">{m.email}</span>
        </button>
      ))}
    </>
  );
}

/* ── Team player manager ─────────────────────────────────────────────────── */
export function TeamPlayerManager({
  slug,
  team,
  isAdmin,
  currentUserId,
  isOwnedByGuest,
  groupMembers,
  onUpdated,
}: {
  slug: string;
  team: TournamentTeam;
  isAdmin: boolean;
  currentUserId: string | undefined;
  isOwnedByGuest: boolean;
  groupMembers: GroupMember[];
  onUpdated: () => void;
}) {
  const canManage = isAdmin || team.user_id === currentUserId || isOwnedByGuest;
  const [playerName, setPlayerName] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasSuggestions = useMemo(() => {
    if (!playerName.trim() || !groupMembers.length) return false;
    const lq = playerName.toLowerCase();
    return groupMembers.some((m) => m.name.toLowerCase().includes(lq) || m.email.toLowerCase().includes(lq));
  }, [playerName, groupMembers]);

  if (!canManage) {
    // Show players read-only for non-managers
    if (team.players.length === 0) return null;
    return (
      <div className="mt-1.5 ml-10 space-y-1">
        {team.players.map((p) => (
          <div key={p.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {p.user_image_url ? (
              <UserAvatar name={p.name} imageUrl={p.user_image_url} className="size-4 shrink-0" />
            ) : (
              <div className="size-4 rounded-full bg-muted flex items-center justify-center shrink-0 text-[9px]">
                {p.name[0]?.toUpperCase()}
              </div>
            )}
            <span className="truncate">{p.name}</span>
          </div>
        ))}
      </div>
    );
  }

  const handleSelect = (m: GroupMember) => {
    setPlayerName(m.name);
    setSelectedUserId(m.user_id);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleAdd = async () => {
    const name = playerName.trim();
    if (!name) return;
    setAdding(true);
    try {
      await addTeamPlayer(slug, team.id, name, selectedUserId);
      setPlayerName("");
      setSelectedUserId(null);
      onUpdated();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to add player");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (playerId: string) => {
    try {
      await removeTeamPlayer(slug, team.id, playerId);
      onUpdated();
    } catch {
      toast.error("Failed to remove player");
    }
  };

  return (
    <div className="mt-1.5 ml-10 space-y-1">
      <AnimatePresence initial={false}>
        {team.players.map((p) => (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-1.5 text-xs text-muted-foreground group overflow-hidden"
          >
            {p.user_image_url ? (
              <UserAvatar name={p.name} imageUrl={p.user_image_url} className="size-4 shrink-0" />
            ) : (
              <div className="size-4 rounded-full bg-muted flex items-center justify-center shrink-0 text-[9px]">
                {p.name[0]?.toUpperCase()}
              </div>
            )}
            <span className="flex-1 truncate">{p.name}</span>
            <button
              className="sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 text-destructive hover:text-destructive/80 transition-opacity rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive"
              onClick={() => handleRemove(p.id)}
              aria-label={`Remove ${p.name}`}
            >
              <X className="size-3" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
      <Popover open={showSuggestions && hasSuggestions} onOpenChange={setShowSuggestions}>
        <PopoverAnchor asChild>
          <Input
            ref={inputRef}
            className="h-6 text-xs px-2"
            placeholder="Add player…"
            value={playerName}
            onChange={(e) => {
              setPlayerName(e.target.value);
              setSelectedUserId(null);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            disabled={adding}
          />
        </PopoverAnchor>
        <PopoverContent
          className="p-0 overflow-hidden"
          align="start"
          sideOffset={2}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          style={{ width: "var(--radix-popover-trigger-width)" }}
        >
          <MemberSuggestionItems query={playerName} members={groupMembers} onSelect={handleSelect} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ── Round settings ── */
export function RoundSettings({
  tournament,
  slug,
  onUpdated,
}: {
  tournament: TournamentDetail;
  slug: string;
  onUpdated: (t: TournamentDetail) => void;
}) {
  const numRounds = tournament.num_rounds!;
  const [saving, setSaving] = useState<number | null>(null);

  const getRoundSettings = (round: number) => {
    const match = tournament.matches.find((m) => m.round === round);
    return {
      goals_to_win: match?.goals_to_win ?? tournament.goals_per_game,
      win_by: match?.win_by ?? 2,
    };
  };

  const handleUpdate = async (round: number, field: "goals_to_win" | "win_by", value: number) => {
    setSaving(round);
    try {
      const updated = await updateRoundSettings(slug, round, { [field]: value });
      onUpdated(updated);
    } catch {
      toast.error("Failed to update settings");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground">Goal settings per round</p>
      {Array.from({ length: numRounds }, (_, i) => i + 1).map((r) => {
        const s = getRoundSettings(r);
        return (
          <div key={r} className="flex items-center gap-2 text-xs">
            <span className="w-24 truncate font-medium">{roundLabel(r, numRounds)}</span>
            <Input
              type="number"
              min={1}
              className="h-6 w-14 text-xs px-1 text-center"
              value={s.goals_to_win}
              onChange={(e) => handleUpdate(r, "goals_to_win", Math.max(1, parseInt(e.target.value) || 1))}
              disabled={saving === r}
            />
            <span className="text-muted-foreground">goals, win by</span>
            <Input
              type="number"
              min={1}
              className="h-6 w-14 text-xs px-1 text-center"
              value={s.win_by}
              onChange={(e) => handleUpdate(r, "win_by", Math.max(1, parseInt(e.target.value) || 1))}
              disabled={saving === r}
            />
          </div>
        );
      })}
    </div>
  );
}
