import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { type TournamentMatch, type TournamentTeam, resolveImageUrl } from "@/lib/api";
import { Trophy, Play, Radio } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Layout constants ────────────────────────────────────────────────────────
const SLOT1 = 110;   // slot height for round-1 cards (px)
const CARD_W = 260;  // card width (px)
const CONN_W = 40;   // connector column width (px)
const LABEL_H = 28;  // round-label row height (px)
const TEAM_IMG_W = 64; // team image width in bracket row (px)

function TeamSlot({
  team, isWinner, score, isTbd,
}: {
  team: TournamentTeam | null;
  isWinner: boolean;
  score: number | null;
  isTbd: boolean;
}) {
  const teamImgUrl = team?.image_url ? resolveImageUrl(team.image_url) : null;
  return (
    <div className={cn("relative flex items-stretch min-w-0 overflow-hidden", isWinner && "font-semibold", !team && "text-muted-foreground")}>
      {teamImgUrl ? (
        <img src={teamImgUrl} alt={team!.name} className="shrink-0 object-cover" style={{ width: TEAM_IMG_W }} />
      ) : (
        <div className="shrink-0 bg-muted/30" style={{ width: TEAM_IMG_W }} />
      )}
      <div className="flex items-center gap-2 flex-1 min-w-0 px-2.5 py-2">
        <span className="truncate text-sm leading-tight flex-1 min-w-0">
          {isTbd ? <span className="italic text-muted-foreground text-xs">TBD</span> : (team?.name ?? "—")}
        </span>
        {score !== null && (
          <span className={cn("text-sm tabular-nums shrink-0", isWinner ? "text-foreground" : "text-muted-foreground")}>{score}</span>
        )}
        {isWinner && (
          <motion.span
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 15, delay: 0.2 }}
          >
            <Trophy className="size-3 shrink-0 text-yellow-500" />
          </motion.span>
        )}
      </div>
    </div>
  );
}

interface MatchCardProps {
  match: TournamentMatch;
  isAdmin?: boolean;
  slug: string;
  onStartMatch?: () => void;
}

function MatchCard({ match, isAdmin, slug, onStartMatch }: MatchCardProps) {
  const isCompleted = match.status === "completed";
  const bothTeams = match.team_a !== null && match.team_b !== null;
  const canStart = isAdmin && !isCompleted && !match.is_bye && bothTeams && match.game_id == null;
  const isLive = match.game_id != null && !isCompleted;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={cn(
        "rounded-lg border bg-card text-card-foreground shadow-sm flex flex-col overflow-hidden transition-shadow",
        (canStart || isLive) && "hover:shadow-md",
        match.is_bye && "opacity-60",
        isLive && "border-red-500/40",
        isCompleted && "ring-1 ring-primary/20",
      )}
      style={{ width: CARD_W }}
    >
      <div className={cn(isCompleted && match.winner_id === match.team_a?.id && "bg-primary/8")}>
        <TeamSlot team={match.team_a} isWinner={isCompleted && match.winner_id === match.team_a?.id} score={match.score_a ?? null} isTbd={!match.is_bye && match.team_a === null} />
      </div>
      <div className={cn(isCompleted && match.winner_id === match.team_b?.id && "bg-primary/8")}>
        {match.is_bye ? (
          <div className="flex items-center px-2.5 py-2 text-muted-foreground text-xs italic">BYE</div>
        ) : (
          <TeamSlot team={match.team_b} isWinner={isCompleted && match.winner_id === match.team_b?.id} score={match.score_b ?? null} isTbd={match.team_b === null} />
        )}
      </div>
      {isLive && (
        <div className="border-t text-xs bg-red-500/5">
          <Link to={`/tournament/${slug}/match/${match.id}/game`} className="flex items-center justify-center gap-1.5 w-full py-1.5 text-red-500 hover:bg-red-500/10 transition-colors font-medium">
            <Radio className="size-3 animate-pulse" />
            Live
          </Link>
        </div>
      )}
      {canStart && (
        <div className="border-t text-xs">
          <button
            className="flex items-center justify-center gap-1.5 w-full py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            onClick={onStartMatch}
          >
            <Play className="size-3" />
            Start match
          </button>
        </div>
      )}
    </motion.div>
  );
}

function ConnectorSvg({ roundMatchCount, slotH }: { roundMatchCount: number; slotH: number }) {
  const pairCount = Math.floor(roundMatchCount / 2);
  const totalH = roundMatchCount * slotH;
  const mid_x = CONN_W / 2;
  return (
    <svg width={CONN_W} height={totalH} style={{ display: "block", overflow: "visible", flexShrink: 0 }}>
      {Array.from({ length: pairCount }).map((_, p) => {
        const top_cy = (2 * p) * slotH + slotH / 2;
        const bot_cy = (2 * p + 1) * slotH + slotH / 2;
        const meet_y = (2 * p + 1) * slotH;
        return (
          <path key={p} d={`M0,${top_cy} H${mid_x} V${bot_cy} M0,${bot_cy} H${mid_x} M${mid_x},${meet_y} H${CONN_W}`}
            stroke="currentColor" strokeWidth="1.5" fill="none" className="text-border"
            strokeLinecap="round" strokeLinejoin="round" />
        );
      })}
    </svg>
  );
}

interface BracketViewProps {
  matches: TournamentMatch[];
  numRounds: number;
  slug: string;
  onStartMatch?: (match: TournamentMatch) => void;
  isAdmin?: boolean;
}

export const roundLabel = (r: number, total: number) => {
  if (r === total) return "Final";
  if (r === total - 1) return "Semi-finals";
  if (r === total - 2) return "Quarter-finals";
  return `Round ${r}`;
};

export default function BracketView({ matches, numRounds, slug, onStartMatch, isAdmin }: BracketViewProps) {
  const rounds: TournamentMatch[][] = [];
  for (let r = 1; r <= numRounds; r++) {
    rounds.push(matches.filter((m) => m.round === r).sort((a, b) => a.position - b.position));
  }
  return (
    <div className="overflow-x-auto pb-4">
      <div className="inline-flex items-start" style={{ gap: 0 }}>
        {rounds.map((roundMatches, ri) => {
          const r = ri + 1;
          const slotH = Math.pow(2, r - 1) * SLOT1;
          const isLast = r === numRounds;
          return (
            <div key={r} className="flex items-start" style={{ gap: 0 }}>
              <div style={{ width: CARD_W }}>
                <div style={{ height: LABEL_H }} className="flex items-center justify-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {roundLabel(r, numRounds)}
                </div>
                <div className="flex flex-col">
                  {roundMatches.map((match, mi) => (
                    <motion.div
                      key={match.id}
                      style={{ height: slotH }}
                      className="flex items-center"
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: ri * 0.15 + mi * 0.05 }}
                    >
                      <MatchCard match={match} isAdmin={isAdmin} slug={slug} onStartMatch={() => onStartMatch?.(match)} />
                    </motion.div>
                  ))}
                </div>
              </div>
              {!isLast && (
                <div style={{ paddingTop: LABEL_H }}>
                  <ConnectorSvg roundMatchCount={roundMatches.length} slotH={slotH} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
