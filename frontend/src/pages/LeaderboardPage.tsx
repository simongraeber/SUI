import { useEffect, useState, useMemo, useCallback } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { FormDots, eloColor } from "@/components/FormDots";
import { motion } from "framer-motion";
import { type ColumnDef } from "@tanstack/react-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
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
import LoadingState from "@/components/LoadingState";
import AskAI from "@/components/AskAI";
import { staggerContainer, fadeUp } from "@/lib/animations";
import {
  getGroupStats,
  resolveImageUrl,
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

/* ── Info tooltip ── */
function InfoTooltip() {
  return (
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
  );
}



/* ── Main component ── */
function LeaderboardPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const [stats, setStats] = useState<GroupStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodKey>("all");

  const fetchStats = useCallback(
    (p: PeriodKey) => {
      if (!groupId) return;
      setLoading(true);
      const range = getDateRange(p);
      getGroupStats(groupId, range.start, range.end)
        .then(setStats)
        .catch(() => {})
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
          cell: ({ row }) => {
            const idx = row.index;
            return (
              <span className="font-medium">
                {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : idx + 1}
              </span>
            );
          },
        },
        {
          accessorKey: "name",
          header: "Player",
          enableSorting: false,
          cell: ({ row }) => {
            const p = row.original;
            return (
              <div
                className="flex items-center gap-2 cursor-pointer hover:opacity-80"
                onClick={() => navigate(`/group/${groupId}/member/${p.user_id}`)}
              >
                <Avatar className="h-7 w-7">
                  <AvatarImage
                    src={resolveImageUrl(p.image_url) ?? undefined}
                    alt={p.name}
                  />
                  <AvatarFallback className="text-[10px]">
                    {p.name?.charAt(0)?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate max-w-[120px] underline-offset-2 hover:underline">{p.name}</span>
                {p.provisional && (
                  <HoverCard>
                    <HoverCardTrigger asChild>
                      <span
                        className="shrink-0 inline-flex items-center justify-center size-4 text-[9px] leading-none font-bold bg-muted text-muted-foreground rounded-full cursor-help"
                        aria-label="Provisional rating"
                      >
                        P
                      </span>
                    </HoverCardTrigger>
                    <HoverCardContent className="w-48 text-xs">
                      Provisional — rating will stabilize after 10 games
                    </HoverCardContent>
                  </HoverCard>
                )}
              </div>
            );
          },
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
                {p.elo}
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
                {v}
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
    [isPeriod],
  );

  if (loading && !stats) return <LoadingState message="Loading stats…" />;

  if (!stats) return <LoadingState message="Could not load stats." />;

  const { summary, total_games } = stats;

  return (
    <PageTransition className="max-w-4xl mx-auto px-4 py-8">
      <div className="text-center mb-6">
        <h1 className="text-3xl font-bold mb-2">Leaderboard</h1>
        <p className="text-muted-foreground">
          Elo-based skill rankings
        </p>
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
      {total_games === 0 && !loading ? (
        <Card className="mb-8">
          <CardContent className="py-8 text-center text-muted-foreground italic">
            No games played{isPeriod ? " in this period" : " yet"}.
          </CardContent>
        </Card>
      ) : (
        <motion.div
          className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8"
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          <motion.div variants={fadeUp}>
            <Card>
              <CardContent className="pt-5 pb-4 text-center">
                <Gamepad2 className="size-5 mx-auto mb-1.5 text-blue-500" />
                <p className="text-xs text-muted-foreground">Total Games</p>
                <p className="text-xl font-bold">{total_games}</p>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={fadeUp}>
            <Card>
              <CardContent className="pt-5 pb-4 text-center">
                <Crown className="size-5 mx-auto mb-1.5 text-yellow-500" />
                <p className="text-xs text-muted-foreground">Highest Rated</p>
                {summary.highest_rated ? (
                  <>
                    <p className="text-sm font-bold truncate">
                      {summary.highest_rated.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {summary.highest_rated.elo} Elo
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground italic">—</p>
                )}
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={fadeUp}>
            <Card>
              <CardContent className="pt-5 pb-4 text-center">
                <Goal className="size-5 mx-auto mb-1.5 text-red-500" />
                <p className="text-xs text-muted-foreground">Top Scorer</p>
                {summary.top_scorer ? (
                  <>
                    <p className="text-sm font-bold truncate">
                      {summary.top_scorer.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {summary.top_scorer.goals} goal
                      {summary.top_scorer.goals !== 1 ? "s" : ""}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground italic">—</p>
                )}
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={fadeUp}>
            <Card>
              <CardContent className="pt-5 pb-4 text-center">
                <Flame className="size-5 mx-auto mb-1.5 text-orange-500" />
                <p className="text-xs text-muted-foreground">Hot Streak</p>
                {summary.hot_streak ? (
                  <>
                    <p className="text-sm font-bold truncate">
                      {summary.hot_streak.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      W{summary.hot_streak.count}
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
      {total_games > 0 && (
        <Card className="relative">
          <InfoTooltip />
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="size-5" />
              Player Rankings
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.players.length === 0 ? (
              <p className="text-center text-muted-foreground italic py-8">
                No data yet. Play some games!
              </p>
            ) : (
              <>
                <DataTable
                  columns={columns}
                  data={stats.players}
                  defaultSorting={
                    isPeriod
                      ? [{ id: "elo_delta", desc: true }]
                      : [{ id: "elo", desc: true }]
                  }
                />
                <p className="text-xs text-muted-foreground mt-3">
                  GP = Games Played · W = Wins · L = Losses ·
                  Win% = Win Rate · GS = Goals Scored · GC = Goals Conceded ·
                  GD = Goal Difference
                  {isPeriod && " · ±Δ = Elo Change"}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Ask AI ── */}
      {groupId && <AskAI groupId={groupId} />}

      <div className="flex flex-wrap justify-center gap-3 mt-6">
        <Button variant="outline" asChild>
          <Link to={`/group/${groupId}`}>
            <ArrowLeft className="size-4" />
            Back to Group
          </Link>
        </Button>
      </div>
    </PageTransition>
  );
}

export default LeaderboardPage;
