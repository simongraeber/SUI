import { CalendarDays, Clock, Goal, Swords, Trophy } from "lucide-react";
import UserAvatar from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { GameResponse } from "@/lib/api";

interface GameDetailsDialogProps {
  game: GameResponse | null;
  onOpenChange: (open: boolean) => void;
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export default function GameDetailsDialog({
  game,
  onOpenChange,
}: GameDetailsDialogProps) {
  if (!game) return null;

  const sideA = game.players.filter((player) => player.side === "a");
  const sideB = game.players.filter((player) => player.side === "b");
  const playedAt = new Date(game.created_at);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] w-[calc(100%_-_1.5rem)] gap-0 overflow-y-auto rounded-xl p-0 sm:max-w-lg sm:rounded-2xl">
        <DialogHeader className="px-5 pb-4 pt-5 pr-12 text-left sm:px-6 sm:pb-5 sm:pt-6 sm:pr-12">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Swords className="size-4" />
            </div>
            <div className="min-w-0">
              <DialogTitle>Game Details</DialogTitle>
              <DialogDescription className="mt-1 flex items-center gap-1.5">
                <CalendarDays className="size-3.5 shrink-0" />
                <span className="truncate">
                  {playedAt.toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                  {" at "}
                  {playedAt.toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="mx-4 rounded-xl border bg-muted/50 px-3 py-4 sm:mx-6 sm:px-5 sm:py-5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-1 sm:gap-4">
            <TeamDetails
              label="Side A"
              players={sideA}
              winner={game.winner === "a"}
              labelClassName="text-blue-600 dark:text-blue-400"
            />
            <div className="flex min-w-[4.75rem] flex-col items-center pt-6 text-center sm:min-w-[6rem]">
              <Badge variant="outline" className="mb-2 bg-background text-[10px]">
                Final
              </Badge>
              <p className="whitespace-nowrap text-3xl font-bold tabular-nums sm:text-4xl">
                {game.score_a} <span className="text-muted-foreground">-</span> {game.score_b}
              </p>
              <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="size-3.5" />
                {formatElapsed(game.elapsed)}
              </p>
            </div>
            <TeamDetails
              label="Side B"
              players={sideB}
              winner={game.winner === "b"}
              labelClassName="text-red-500 dark:text-red-400"
            />
          </div>
        </div>

        <div className="mt-5 border-t px-5 pb-5 pt-4 sm:px-6 sm:pb-6">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Goal className="size-4 text-primary" />
            Goal Timeline
          </h3>
          {game.goals.length > 0 ? (
            <ol className="space-y-1">
              {game.goals.map((goal) => (
                <li key={goal.id} className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 text-sm odd:bg-muted/50">
                  <span className="w-10 shrink-0 font-medium tabular-nums text-muted-foreground">
                    {formatElapsed(goal.elapsed_at)}
                  </span>
                  <UserAvatar
                    name={goal.scorer_name}
                    imageUrl={goal.scorer_image_url}
                    className="size-7 shrink-0"
                    fallbackClassName="text-[10px]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{goal.scorer_name}</p>
                    {goal.friendly_fire && (
                      <p className="text-[11px] text-red-500">Own goal</p>
                    )}
                  </div>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    Side {goal.side.toUpperCase()}
                  </Badge>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">No goals were recorded.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TeamDetails({
  label,
  players,
  winner,
  labelClassName,
}: {
  label: string;
  players: GameResponse["players"];
  winner: boolean;
  labelClassName: string;
}) {
  const playerNames = players.map((player) => player.name).join(" & ");

  return (
    <div className="min-w-0 text-center">
      <p className={`mb-2 text-xs font-semibold ${labelClassName}`}>{label}</p>
      <div className="flex h-11 items-center justify-center -space-x-2">
        {players.map((player, index) => (
          <UserAvatar
            key={`${player.user_id ?? player.name}-${index}`}
            name={player.name}
            imageUrl={player.image_url}
            className="size-10 ring-2 ring-card"
            fallbackClassName="text-xs"
          />
        ))}
      </div>
      <p className="mt-2 min-h-8 break-words text-xs font-medium leading-4" title={playerNames}>
        {playerNames}
      </p>
      <div className="mt-1 flex h-5 justify-center">
        {winner && (
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <Trophy className="size-3" /> Winner
          </Badge>
        )}
      </div>
    </div>
  );
}