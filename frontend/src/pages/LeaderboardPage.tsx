import { useEffect, useState, useMemo, useCallback, useTransition } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { FormDots } from "@/components/FormDots";
import { eloColor, formatElo } from "@/lib/utils";
import { motion } from "framer-motion";
import { type ColumnDef } from "@tanstack/react-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import UserAvatar from "@/components/UserAvatar";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "@/components/ui/hover-card";
import {
  ArrowLeft,
  ArrowUpDown,
  Shield,
  Info,
  Gamepad2,
  Crown,
  Goal,
  Flame,
} from "lucide-react";
import PageTransition from "@/components/PageTransition";
import AskAI from "@/components/AskAI";
import { Skeleton } from "@/components/ui/skeleton";
import { cardSlideUp, fadeUp, staggerContainer } from "@/lib/animations";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getGroupStats,
  type GroupStats,
  type PlayerStats,
} from "@/lib/api";

/* ── Time period helpers ── */
type PeriodKey =
  | "all"
  | "this_week"
  | "this_month"
  | "last_30"
  | "last_90";

const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "all", label: "All Time" },
  { key: "this_week", label: "This Week" },
  { key: "this_month", label: "This Month" },
  { key: "last_30", label: "30 Days" },
  { key: "last_90", label: "90 Days" },
];

function getDateRange(key: PeriodKey): {
  start?: string;
  end?: string;
} {
  if (key === "all") return {};
  const now = new Date();
  let start: Date;

  switch (key) {
    case "this_week": {
      const day = now.getDay();
      const diff = day === 0 ? 6 : day - 1; // Monday = 0
      start = new Date(now);
      start.setDate(now.getDate() - diff);
      start.setHours(0, 0, 0, 0);
      break;
    }
    case "this_month":
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case "last_30":
      start = new Date(now);
      start.setDate(now.getDate() - 30);
      break;
    case "last_90":
      start = new Date(now);
      start.setDate(now.getDate() - 90);
      break;
  }

  return {
    start: start!.toISOString(),
    end: now.toISOString(),
  };
}

/* ── Player name cell (isolated transition state) ── */
function PlayerCell({ player, groupId }: { player: PlayerStats; groupId: string }) {
  const navigate = useNavigate();
  const [isPending, startTransition] = useTransition();

  return (
    <div
      className={`flex items-center gap-2 cursor-pointer hover:opacity-80 ${isPending ? "animate-pulse" : ""}`}
      onClick={() => {
        startTransition(() => navigate(`/group/${groupId}/member/${player.user_id}`));
      }}
    >
      <UserAvatar name={player.name} imageUrl={player.image_url} className="h-7 w-7" fallbackClassName="text-[10px]" />
      <span className="truncate max-w-[120px] underline-offset-2 hover:underline">{player.name}</span>
    </div>
  );
}

/* ── Main component ── */
function LeaderboardPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const [stats, setStats] = useState<GroupStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodKey>("last_90");

  const fetchStats = useCallback(
    (p: PeriodKey) => {
      if (!groupId) return;
      setLoading(true);
      const range = getDateRange(p);
      getGroupStats(groupId, range.start, range.end)
        .then(setStats)
        .catch(() => navigate(`/group/${groupId}`, { replace: true }))
        .finally(() => setLoading(false));
    },
    [groupId],
  );

  useEffect(() => {
    fetchStats(period);
  }, [fetchStats, period]);

  const isPeriod = period !== "all";

  const columns = useMemo<ColumnDef<PlayerStats>[]>(
    () => {
      const cols: ColumnDef<PlayerStats>[] = [
        {
          id: "rank",
          header: "#",
          enableSorting: false,
          meta: { className: "w-12 text-center" },
          cell: ({ row, table }) => {
            const player = row.original;
            if (player.provisional) {
              return (
                <HoverCard>
                  <HoverCardTrigger asChild>
                    <span
                      className="mx-auto inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold leading-none text-muted-foreground cursor-help"
                      aria-label="Provisional rating"
                    >
                      <span className="relative -top-px leading-none">P</span>
                    </span>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-48 text-xs">
                    Provisional — rating will stabilize after 10 games
                  </HoverCardContent>
                </HoverCard>
              );
            }
            // Count only non-provisional players above this row
            const rank = table.getRowModel().rows
              .slice(0, row.index)
              .filter(r => !r.original.provisional).length + 1;
            return (
              <span className="mx-auto inline-flex w-5 items-center justify-center font-medium leading-none">
                {rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank}
              </span>
            );
          },
        },
        {
          accessorKey: "name",
          header: "Player",
          enableSorting: false,
          cell: ({ row }) => (
            <PlayerCell player={row.original} groupId={groupId!} />
          ),
        },
        {
          accessorKey: "elo",
          header: ({ column }) => (
            <Button
              variant="ghost"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
            >
              Elo
              <ArrowUpDown className="ml-1 h-4 w-4" />
            </Button>
          ),
          cell: ({ row }) => {
            const p = row.original;
            return (
              <span
                className={`block text-center font-bold ${eloColor(p.elo)}`}
              >
                {formatElo(p.elo)}
              </span>
            );
          },
        },
      ];

      // Elo delta — only when period is active
      if (isPeriod) {
        cols.push({
          accessorKey: "elo_delta",
          header: ({ column }) => (
            <Button
              variant="ghost"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
            >
              ±Δ
              <ArrowUpDown className="ml-1 h-4 w-4" />
            </Button>
          ),
          cell: ({ getValue }) => {
            const v = getValue<number>();
            const color =
              v > 0
                ? "text-green-600 dark:text-green-400"
                : v < 0
                  ? "text-red-500"
                  : "text-muted-foreground";
            return (
              <span className={`block text-center font-medium ${color}`}>
                {v > 0 ? "+" : ""}
                {formatElo(v)}
              </span>
            );
          },
        });
      }

      cols.push(
        {
          accessorKey: "games_played",
          header: ({ column }) => (
            <Button
              variant="ghost"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
            >
              GP
              <ArrowUpDown className="ml-1 h-4 w-4" />
            </Button>
          ),
          cell: ({ getValue }) => (
            <span className="block text-center">{getValue<number>()}</span>
          ),
        },
        {
          accessorKey: "wins",
          header: ({ column }) => (
            <Button
              variant="ghost"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
            >
              W
              <ArrowUpDown className="ml-1 h-4 w-4" />
            </Button>
          ),
          cell: ({ getValue }) => (
            <span className="block text-center text-green-600 font-medium">
              {getValue<number>()}
            </span>
          ),
        },
        {
          accessorKey: "losses",
          header: ({ column }) => (
            <Button
              variant="ghost"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
            >
              L
              <ArrowUpDown className="ml-1 h-4 w-4" />
            </Button>
          ),
          cell: ({ getValue }) => (
            <span className="block text-center text-red-500 font-medium">
              {getValue<number>()}
            </span>
          ),
        },
        {
          accessorKey: "win_rate",
          header: ({ column }) => (
            <Button
              variant="ghost"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
            >
              Win%
              <ArrowUpDown className="ml-1 h-4 w-4" />
            </Button>
          ),
          cell: ({ getValue }) => (
            <span className="block text-center font-medium">
              {getValue<number>()}%
            </span>
          ),
        },
        // Desktop-only columns
        {
          accessorKey: "goals_scored",
          header: ({ column }) => (
            <Button
              variant="ghost"
              className="hidden md:inline-flex"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
            >
              GS
              <ArrowUpDown className="ml-1 h-4 w-4" />
            </Button>
          ),
          cell: ({ getValue }) => (
            <span className="hidden md:block text-center">
              {getValue<number>()}
            </span>
          ),
          meta: { className: "hidden md:table-cell" },
        },
        {
          accessorKey: "goals_conceded",
          header: ({ column }) => (
            <Button
              variant="ghost"
              className="hidden md:inline-flex"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
            >
              GC
              <ArrowUpDown className="ml-1 h-4 w-4" />
            </Button>
          ),
          cell: ({ getValue }) => (
            <span className="hidden md:block text-center">
              {getValue<number>()}
            </span>
          ),
          meta: { className: "hidden md:table-cell" },
        },
        {
          accessorKey: "goal_diff",
          header: ({ column }) => (
            <Button
              variant="ghost"
              className="hidden md:inline-flex"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
            >
              GD
              <ArrowUpDown className="ml-1 h-4 w-4" />
            </Button>
          ),
          cell: ({ getValue }) => {
            const v = getValue<number>();
            const color =
              v > 0
                ? "text-green-600 dark:text-green-400"
                : v < 0
                  ? "text-red-500"
                  : "";
            return (
              <span className={`hidden md:block text-center font-medium ${color}`}>
                {v > 0 ? "+" : ""}
                {v}
              </span>
            );
          },
          meta: { className: "hidden md:table-cell" },
        },
        {
          id: "form",
          header: "Form",
          enableSorting: false,
          cell: ({ row }) => <FormDots form={row.original.form} />,
        },
      );

      return cols;
    },
    [isPeriod, groupId],
  );

  if (!loading && !stats) return null;

  const showSkeleton = loading;

  return (
    <PageTransition className="max-w-4xl mx-auto px-4 py-8">
      <Link to={`/group/${groupId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="size-4" />
        Group
      </Link>
      <div className="text-center mb-6">
        <h1 className="text-3xl font-bold">Leaderboard</h1>
        <p className="text-muted-foreground text-sm">Elo-based skill rankings</p>
      </div>

      {/* ── Time span filter ── */}
      <div className="flex flex-wrap justify-center gap-1.5 mb-6">
        {PERIOD_OPTIONS.map((opt) => (
          <Button
            key={opt.key}
            size="sm"
            variant={period === opt.key ? "default" : "outline"}
            onClick={() => setPeriod(opt.key)}
            className="text-xs"
          >
            {opt.label}
          </Button>
        ))}
      </div>

      {/* ── Summary cards ── */}
      {showSkeleton ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[116px] w-full rounded-xl" />
          ))}
        </div>
      ) : stats!.total_games === 0 ? (
        <motion.div
          key={period}
          variants={fadeUp}
          initial="hidden"
          animate="show"
        >
          <Card className="mb-8 h-[244px] sm:h-[116px]">
            <CardContent className="h-full flex flex-col items-center justify-center text-muted-foreground italic">
              <Gamepad2 className="size-8 mb-2 text-muted-foreground/50" />
              No games played{isPeriod ? " in this period" : " yet"}.
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        <motion.div
          className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8"
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          <motion.div variants={cardSlideUp} className="h-full">
            <Card className="h-full">
              <CardContent className="pt-5 pb-4 text-center">
                <Gamepad2 className="size-5 mx-auto mb-1.5 text-blue-500" />
                <p className="text-xs text-muted-foreground">Total Games</p>
                <p className="text-xl font-bold">{stats!.total_games}</p>
              </CardContent>
            </Card>
          </motion.div>
          <motion.div variants={cardSlideUp} className="h-full">
            <Card className="h-full">
              <CardContent className="pt-5 pb-4 text-center">
                <Crown className="size-5 mx-auto mb-1.5 text-yellow-500" />
                <p className="text-xs text-muted-foreground">Highest Rated</p>
                {stats!.summary.highest_rated ? (
                  <>
                    <p className="text-sm font-bold truncate">
                      {stats!.summary.highest_rated.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatElo(stats!.summary.highest_rated.elo)} Elo
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground italic">—</p>
                )}
              </CardContent>
            </Card>
          </motion.div>
          <motion.div variants={cardSlideUp} className="h-full">
            <Card className="h-full">
              <CardContent className="pt-5 pb-4 text-center">
                <Goal className="size-5 mx-auto mb-1.5 text-red-500" />
                <p className="text-xs text-muted-foreground">Top Scorer</p>
                {stats!.summary.top_scorer ? (
                  <>
                    <p className="text-sm font-bold truncate">
                      {stats!.summary.top_scorer.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {stats!.summary.top_scorer.goals} goal
                      {stats!.summary.top_scorer.goals !== 1 ? "s" : ""}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground italic">—</p>
                )}
              </CardContent>
            </Card>
          </motion.div>
          <motion.div variants={cardSlideUp} className="h-full">
            <Card className="h-full">
              <CardContent className="pt-5 pb-4 text-center">
                <Flame className="size-5 mx-auto mb-1.5 text-orange-500" />
                <p className="text-xs text-muted-foreground">Hot Streak</p>
                {stats!.summary.hot_streak ? (
                  <>
                    <p className="text-sm font-bold truncate">
                      {stats!.summary.hot_streak.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      W{stats!.summary.hot_streak.count}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground italic">—</p>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}

      {/* ── Rankings table ── */}
      {showSkeleton && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="size-5" />
              Player Rankings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"><Skeleton className="h-3.5 w-4" /></TableHead>
                    <TableHead><Skeleton className="h-3.5 w-14" /></TableHead>
                    <TableHead><Skeleton className="h-3.5 w-7" /></TableHead>
                    <TableHead><Skeleton className="h-3.5 w-7" /></TableHead>
                    <TableHead><Skeleton className="h-3.5 w-5" /></TableHead>
                    <TableHead><Skeleton className="h-3.5 w-5" /></TableHead>
                    <TableHead><Skeleton className="h-3.5 w-10" /></TableHead>
                    <TableHead><Skeleton className="h-3.5 w-10" /></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-5" /></TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Skeleton className="h-7 w-7 rounded-full shrink-0" />
                          <Skeleton className="h-4 w-20" />
                        </div>
                      </TableCell>
                      <TableCell><Skeleton className="h-4 w-8 mx-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-6 mx-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-6 mx-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-6 mx-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-10 mx-auto" /></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {Array.from({ length: 5 }).map((_, j) => (
                            <Skeleton key={j} className="size-2.5 rounded-full" />
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
      {!showSkeleton && stats!.total_games > 0 && (
        <Card className="relative">
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="absolute top-6 right-6 z-10 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Ranking info"
              >
                <Info className="size-5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 text-xs">
              <p className="font-semibold mb-1">How rankings work</p>
              <p>
                Players are ranked by Elo rating — a skill score that adjusts based on
                match outcomes and opponent strength. Beating stronger opponents gives
                more points. New players (&lt; 10 games) are marked as provisional (P).
              </p>
            </PopoverContent>
          </Popover>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="size-5" />
              Player Rankings
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats!.players.length === 0 ? (
              <p className="text-center text-muted-foreground italic py-8">
                No data yet. Play some games!
              </p>
            ) : (
              <>
                <DataTable
                  columns={columns}
                  data={stats!.players}
                  defaultSorting={
                    isPeriod
                      ? [{ id: "elo_delta", desc: true }]
                      : [{ id: "elo", desc: true }]
                  }
                />
                <p className="text-xs text-muted-foreground mt-3">
                  <span className="whitespace-nowrap">GP = Games Played</span>{" · "}
                  <span className="whitespace-nowrap">W = Wins</span>{" · "}
                  <span className="whitespace-nowrap">L = Losses</span>{" · "}
                  <span className="whitespace-nowrap">Win% = Win Rate</span>{" · "}
                  <span className="whitespace-nowrap">GS = Goals Scored</span>{" · "}
                  <span className="whitespace-nowrap">GC = Goals Conceded</span>{" · "}
                  <span className="whitespace-nowrap">GD = Goal Difference</span>
                  {isPeriod && (
                    <>{" · "}<span className="whitespace-nowrap">±Δ = Elo Change</span></>
                  )}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Ask AI ── */}
      {groupId && <AskAI groupId={groupId} />}
    </PageTransition>
  );
}

export default LeaderboardPage;
