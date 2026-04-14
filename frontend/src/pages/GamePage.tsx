import { useState, useCallback, useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { popIn } from "@/lib/animations";
import { useAuth } from "@/lib/AuthContext";
import UserAvatar from "@/components/UserAvatar";
import "./GamePage.css";
import {
  getGroup,
  getActiveGame,
  createGame,
  updateGame,
  getGame,
  recordGoal,
  deleteGoal,
  getGroupStats,
  getGameById,
  updateGameById,
  recordGoalOnGame,
  deleteGoalOnGame,
  startMatchGame,
  type GroupMember as GroupMemberType,
  type GameResponse,
} from "@/lib/api";

import vsBadge from "../assets/LiveGame/vs-badge.webp";
import sideABanner from "../assets/LiveGame/side-a-banner.webp";
import sideBBanner from "../assets/LiveGame/side-b-banner.webp";
import scoreBtnA from "../assets/LiveGame/score-btn-a.webp";
import scoreBtnB from "../assets/LiveGame/score-btn-b.webp";
import goalSplash from "../assets/LiveGame/goal-splash.webp";
import friendlyFireSplash from "../assets/LiveGame/friendly-fire-splash.webp";
import victoryBanner from "../assets/LiveGame/victory-banner.webp";
import defeatBanner from "../assets/LiveGame/defeat-banner.webp";
import pauseOverlay from "../assets/LiveGame/pause-overlay.webp";
import liveBoardBg from "../assets/LiveGame/live-board-bg.webp";
import noActiveGameImg from "../assets/no-active-game.webp";
import gameCancelledImg from "../assets/game-cancelled.webp";

/* ── types ── */
type PagePhase = "loading" | "setup" | "active" | "paused" | "completed" | "cancelled";
type Side = "a" | "b";

/** Minimal player shape shared by group members and tournament players. */
type PlayerInfo = { key: string; user_id: string | null; name: string; image_url: string | null };

const SYNC_INTERVAL_MS = 2000;

/* ── helpers ── */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Sort members by last_played_at descending (most recent first), never-played last. */
function sortByRecency(members: GroupMemberType[]): PlayerInfo[] {
  return [...members].sort((a, b) => {
    if (!a.last_played_at && !b.last_played_at) return 0;
    if (!a.last_played_at) return 1;
    if (!b.last_played_at) return -1;
    return new Date(b.last_played_at).getTime() - new Date(a.last_played_at).getTime();
  }).map(toPlayerInfo);
}

function toPlayerInfo(m: GroupMemberType): PlayerInfo {
  return { key: m.user_id, user_id: m.user_id, name: m.name, image_url: m.image_url };
}

/* ── animation variants ── */

/** Smooth crossfade for phase changes (no vertical shift). */
const phaseFade = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.35, ease: "easeOut" as const } },
  exit: { opacity: 0, transition: { duration: 0.25, ease: "easeIn" as const } },
};

const scoreBump = {
  bump: {
    scale: [1, 1.4, 1],
    transition: { duration: 0.35 },
  },
};

/* ── component ── */
function GamePage() {
  const { groupId, slug, matchId } = useParams<{ groupId?: string; slug?: string; matchId?: string }>();
  const { refreshUser } = useAuth();

  /** True when rendered from /tournament/:slug/match/:matchId/game */
  const isTournamentGame = Boolean(matchId && slug);

  /* ── API wrappers: pick group-scoped or standalone endpoint ── */
  const fetchGame = useCallback(
    (gId: string) =>
      isTournamentGame ? getGameById(gId) : getGame(groupId!, gId),
    [isTournamentGame, groupId],
  );
  const patchGame = useCallback(
    (gId: string, data: { state?: string }) =>
      isTournamentGame ? updateGameById(gId, data) : updateGame(groupId!, gId, data),
    [isTournamentGame, groupId],
  );
  const postGoal = useCallback(
    (gId: string, data: Parameters<typeof recordGoalOnGame>[1]) =>
      isTournamentGame ? recordGoalOnGame(gId, data) : recordGoal(groupId!, gId, data),
    [isTournamentGame, groupId],
  );
  const removeGoal = useCallback(
    (gId: string, goalId: string) =>
      isTournamentGame ? deleteGoalOnGame(gId, goalId) : deleteGoal(groupId!, gId, goalId),
    [isTournamentGame, groupId],
  );

  const [phase, setPhase] = useState<PagePhase>("loading");

  // setup: player assignment
  const [sideA, setSideA] = useState<PlayerInfo[]>([]);
  const [sideB, setSideB] = useState<PlayerInfo[]>([]);
  const [unassigned, setUnassigned] = useState<PlayerInfo[]>([]);

  // game state (synced with backend)
  const [gameId, setGameId] = useState<string | null>(null);
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [winner, setWinner] = useState<Side | null>(null);
  const [remotePlayers, setRemotePlayers] = useState<GameResponse["players"]>([]);
  const [goalsToWin, setGoalsToWin] = useState(10);
  const [winBy, setWinBy] = useState(2);

  // UI state
  const [lastGoalSide, setLastGoalSide] = useState<Side | null>(null);
  const [lastGoalFF, setLastGoalFF] = useState(false);
  const [lastGoalScorer, setLastGoalScorer] = useState<string | null>(null);
  const [goalKey, setGoalKey] = useState(0);
  const [showAttribution, setShowAttribution] = useState(false);
  const [attrSide, setAttrSide] = useState<Side>("a");
  const [friendlyFire, setFriendlyFire] = useState(false);
  const [saving, setSaving] = useState(false);

  // ELO data for auto-balancing
  const [eloMap, setEloMap] = useState<Map<string, number>>(new Map());

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const goalCountRef = useRef(0);
  // Server-synced elapsed: base value from last poll + local wall-clock delta
  const serverElapsedRef = useRef(0);
  const serverFetchedAtRef = useRef(0);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const refreshedCompletedGameIdRef = useRef<string | null>(null);

  const refreshRatings = useCallback(async () => {
    if (!groupId) return;

    try {
      const stats = await getGroupStats(groupId);
      const map = new Map<string, number>();
      for (const p of stats.players) map.set(p.user_id, p.elo);
      setEloMap(map);
    } catch {
      // ignore rating refresh failures
    }

    await refreshUser();
  }, [groupId, refreshUser]);
  useEffect(() => {
    if (phase !== "active") {
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
      return;
    }
    let released = false;
    const request = async () => {
      try {
        if ("wakeLock" in navigator) {
          wakeLockRef.current = await navigator.wakeLock.request("screen");
        }
      } catch { /* user denied or unsupported */ }
    };
    request();

    // Re-acquire on visibility change (Safari releases on tab switch)
    const onVisibility = () => {
      if (!released && document.visibilityState === "visible" && phase === "active") {
        request();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibility);
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [phase]);

  /* ── load group + check for active game ── */
  useEffect(() => {
    if (isTournamentGame) {
      // ── tournament context: get-or-create the match game ──
      if (!slug || !matchId) return;
      (async () => {
        try {
          const { game_id } = await startMatchGame(slug, matchId);
          const game = await getGameById(game_id);
          setGameId(game.id);
          setScoreA(game.score_a);
          setScoreB(game.score_b);
          setElapsed(game.elapsed);
          setWinner(game.winner as Side | null);
          setRemotePlayers(game.players);
          setGoalsToWin(game.goals_to_win ?? 10);
          setWinBy(game.win_by ?? 2);
          goalCountRef.current = game.goal_count ?? 0;
          serverElapsedRef.current = game.elapsed;
          serverFetchedAtRef.current = Date.now();
          setSideA(game.players.filter((p) => p.side === "a").map((p, i) => ({ key: p.user_id ?? `${p.name}-${i}`, user_id: p.user_id, name: p.name, image_url: p.image_url })));
          setSideB(game.players.filter((p) => p.side === "b").map((p, i) => ({ key: p.user_id ?? `${p.name}-${i}`, user_id: p.user_id, name: p.name, image_url: p.image_url })));
          setUnassigned([]);
          setPhase(game.state as PagePhase);
        } catch {
          setPhase("setup");
        }
      })();
      return;
    }

    // ── group context: original flow ──
    if (!groupId) return;
    (async () => {
      try {
        // Always load group data first
        const groupData = await getGroup(groupId);

        // Fetch ELO ratings for balancing
        try {
          const stats = await getGroupStats(groupId);
          const map = new Map<string, number>();
          for (const p of stats.players) map.set(p.user_id, p.elo);
          setEloMap(map);
        } catch { /* stats unavailable — balancing will use default */ }

        // Try to find an active game (may fail if backend hasn't been updated)
        let activeGame: GameResponse | null = null;
        try {
          activeGame = await getActiveGame(groupId);
        } catch {
          // New game endpoints not available yet — ignore
        }

        if (activeGame) {
          // Rejoin an existing game
          setGameId(activeGame.id);
          setScoreA(activeGame.score_a);
          setScoreB(activeGame.score_b);
          setElapsed(activeGame.elapsed);
          setWinner(activeGame.winner as Side | null);
          setRemotePlayers(activeGame.players);
          setGoalsToWin(activeGame.goals_to_win ?? 10);
          setWinBy(activeGame.win_by ?? 2);
          goalCountRef.current = activeGame.goal_count ?? 0;
          serverElapsedRef.current = activeGame.elapsed;
          serverFetchedAtRef.current = Date.now();

          const assignedIds = new Set(activeGame.players.map((p) => p.user_id));
          const sA = activeGame.players
            .filter((p) => p.side === "a")
            .map((p) => groupData.members.find((m) => m.user_id === p.user_id))
            .filter(Boolean)
            .map((m) => toPlayerInfo(m as GroupMemberType));
          const sB = activeGame.players
            .filter((p) => p.side === "b")
            .map((p) => groupData.members.find((m) => m.user_id === p.user_id))
            .filter(Boolean)
            .map((m) => toPlayerInfo(m as GroupMemberType));
          setSideA(sA);
          setSideB(sB);
          setUnassigned(sortByRecency(groupData.members.filter((m) => !assignedIds.has(m.user_id))));

          setPhase(activeGame.state as PagePhase);
        } else {
          setUnassigned(sortByRecency(groupData.members));
          setPhase("setup");
        }
      } catch {
        setPhase("setup");
      }
    })();
  }, [groupId, isTournamentGame, slug, matchId]);

  /* ── timer (display only — derives from server elapsed + local delta) ── */
  useEffect(() => {
    if (phase === "active") {
      timerRef.current = setInterval(() => {
        const localDelta = serverFetchedAtRef.current
          ? Math.floor((Date.now() - serverFetchedAtRef.current) / 1000)
          : 0;
        setElapsed(serverElapsedRef.current + localDelta);
      }, 250);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

  /* ── live sync polling ── */
  useEffect(() => {
    if (!gameId) return;
    if (!groupId && !isTournamentGame) return;
    if (phase !== "active" && phase !== "paused" && phase !== "setup") return;

    syncRef.current = setInterval(async () => {
      try {
        const g = await fetchGame(gameId);
        if (
          phaseRef.current === "active" ||
          phaseRef.current === "paused" ||
          phaseRef.current === "setup"
        ) {
          setScoreA(g.score_a);
          setScoreB(g.score_b);
          setRemotePlayers(g.players);

          // Sync time from server — always use server as source of truth
          serverElapsedRef.current = g.elapsed;
          serverFetchedAtRef.current = Date.now();
          setElapsed(g.elapsed);

          // Detect new goals from other clients → show splash
          if (g.goal_count > goalCountRef.current && goalCountRef.current > 0) {
            // A new goal was scored by someone else — show the splash
            const lastGoal = g.goals?.[g.goals.length - 1];
            if (lastGoal) {
              setLastGoalSide(lastGoal.side as Side);
              setLastGoalFF(lastGoal.friendly_fire);
              setLastGoalScorer(lastGoal.scorer_name);
              setGoalKey((k) => k + 1);
            }
          }
          goalCountRef.current = g.goal_count;

          if (g.state !== phaseRef.current) {
            if (g.state === "completed") {
              setWinner(g.winner as Side | null);
              setPhase("completed");
            } else if (g.state === "cancelled") {
              setPhase("cancelled");
            } else {
              setPhase(g.state as PagePhase);
            }
          }
        }
      } catch {
        // silently retry
      }
    }, SYNC_INTERVAL_MS);

    return () => {
      if (syncRef.current) clearInterval(syncRef.current);
    };
  }, [fetchGame, gameId, phase]);

  useEffect(() => {
    if (phase !== "completed" || !gameId) return;
    if (refreshedCompletedGameIdRef.current === gameId) return;

    refreshedCompletedGameIdRef.current = gameId;
    void refreshRatings();
  }, [gameId, phase, refreshRatings]);

  /* ── setup: assign player to side ── */
  const assignPlayer = useCallback((member: PlayerInfo, side: Side) => {
    setUnassigned((prev) => prev.filter((m) => m.key !== member.key));
    setSideA((prev) => prev.filter((m) => m.key !== member.key));
    setSideB((prev) => prev.filter((m) => m.key !== member.key));
    if (side === "a") {
      setSideA((prev) => [...prev, member]);
    } else {
      setSideB((prev) => [...prev, member]);
    }
  }, []);

  const unassignPlayer = useCallback((member: PlayerInfo) => {
    setSideA((prev) => prev.filter((m) => m.key !== member.key));
    setSideB((prev) => prev.filter((m) => m.key !== member.key));
    setUnassigned((prev) => [...prev, member]);
  }, []);

  /* ── auto-balance: distribute assigned players for fairest teams ── */
  const autoBalance = useCallback(() => {
    const pool = [...sideA, ...sideB];
    if (pool.length < 2) return;

    const DEFAULT_ELO = 1000;
    const elo = (p: PlayerInfo) => (p.user_id ? eloMap.get(p.user_id) : undefined) ?? DEFAULT_ELO;
    // Sort by ELO descending (best players first)
    pool.sort((a, b) => elo(b) - elo(a));

    // Greedy partition: assign each player to the team with lower total ELO
    const newA: PlayerInfo[] = [];
    const newB: PlayerInfo[] = [];
    let sumA = 0;
    let sumB = 0;

    for (const player of pool) {
      if (sumA <= sumB) {
        newA.push(player);
        sumA += elo(player);
      } else {
        newB.push(player);
        sumB += elo(player);
      }
    }

    setSideA(newA);
    setSideB(newB);
  }, [sideA, sideB, eloMap]);

  /* ── balance indicator (0-100%) ── */
  const balanceInfo = (() => {
    const DEFAULT_ELO = 1000;
    if (sideA.length === 0 || sideB.length === 0) return null;

    const elo = (p: PlayerInfo) => (p.user_id ? eloMap.get(p.user_id) : undefined) ?? DEFAULT_ELO;
    const avgA = sideA.reduce((s, m) => s + elo(m), 0) / sideA.length;
    const avgB = sideB.reduce((s, m) => s + elo(m), 0) / sideB.length;
    const maxAvg = Math.max(avgA, avgB, 1);
    const diff = Math.abs(avgA - avgB);
    const pct = Math.round(Math.max(0, (1 - diff / maxAvg) * 100));

    // Continuous gradient: 75 = red (hue 0°), 100 = green (hue 120°)
    const hue = Math.round(Math.min(Math.max((pct - 75) / 25, 0), 1) * 120);
    const color = `hsl(${hue}, 75%, 58%)`;

    return { pct, color, diff: Math.round(diff), avgA: Math.round(avgA), avgB: Math.round(avgB) };
  })();

  /* ── start game (create on server) — group context only ── */
  const startGame = useCallback(async () => {
    if (!groupId || sideA.length === 0 || sideB.length === 0) return;
    setSaving(true);
    try {
      const game = await createGame(
        groupId,
        sideA.map((m) => m.user_id).filter(Boolean) as string[],
        sideB.map((m) => m.user_id).filter(Boolean) as string[],
      );
      setGameId(game.id);
      setScoreA(0);
      setScoreB(0);
      setElapsed(0);
      setWinner(null);
      setLastGoalSide(null);
      setLastGoalFF(false);
      setLastGoalScorer(null);
      setRemotePlayers(game.players);
      goalCountRef.current = 0;

      await updateGame(groupId, game.id, { state: "active" });
      serverElapsedRef.current = 0;
      serverFetchedAtRef.current = Date.now();
      setPhase("active");
    } catch (e) {
      console.error("Failed to start game:", e);
    } finally {
      setSaving(false);
    }
  }, [groupId, sideA, sideB]);

  /* ── start tournament game (activate pre-created game) ── */
  const startTournamentGame = useCallback(async () => {
    if (!gameId) return;
    setSaving(true);
    try {
      await patchGame(gameId, { state: "active" });
      serverElapsedRef.current = 0;
      serverFetchedAtRef.current = Date.now();
      setPhase("active");
    } catch (e) {
      console.error("Failed to start tournament game:", e);
    } finally {
      setSaving(false);
    }
  }, [patchGame, gameId]);

  /* ── toggle pause ── */
  const togglePause = useCallback(async () => {
    if (!gameId) return;
    const newState = phase === "active" ? "paused" : "active";
    try {
      await patchGame(gameId, { state: newState });
      setPhase(newState);
    } catch (e) {
      console.error("Failed to toggle pause:", e);
    }
  }, [patchGame, gameId, phase]);

  /* ── cancel game ── */
  const cancelGame = useCallback(async () => {
    if (!gameId) return;
    try {
      await patchGame(gameId, { state: "cancelled" });
      setPhase("cancelled");
    } catch (e) {
      console.error("Failed to cancel game:", e);
    }
  }, [patchGame, gameId]);

  /* ── open goal attribution dialog ── */
  const openGoalDialog = useCallback(
    (side: Side) => {
      if (phase !== "active") return;
      setAttrSide(side);
      setFriendlyFire(false);
      setShowAttribution(true);
    },
    [phase],
  );

  /* ── confirm goal (called directly when player is tapped) ── */
  const confirmGoal = useCallback(async (scorerId: string | null, scorerNameFallback: string) => {
    if (!gameId) return;

    const scoringSide = friendlyFire ? (attrSide === "a" ? "b" : "a") : attrSide;

    const newA = scoringSide === "a" ? scoreA + 1 : scoreA;
    const newB = scoringSide === "b" ? scoreB + 1 : scoreB;

    // Resolve scorer display name for splash
    const allPlayers = remotePlayers.length > 0 ? remotePlayers : [...sideA, ...sideB];
    const scorerPlayer = scorerId ? allPlayers.find((p) => p.user_id === scorerId) : null;
    const scorerName = scorerPlayer ? scorerPlayer.name : scorerNameFallback;

    setScoreA(newA);
    setScoreB(newB);
    setLastGoalSide(scoringSide);
    setLastGoalFF(friendlyFire);
    setLastGoalScorer(scorerName);
    setGoalKey((k) => k + 1);
    setShowAttribution(false);

    // Update local goal count so we don't re-trigger splash on sync
    goalCountRef.current += 1;

    try {
      const goalData = {
        scored_by: scorerId,
        scorer_name: scorerName,
        side: scoringSide,
        friendly_fire: friendlyFire,
        elapsed_at: elapsed,
      };
      const g = await postGoal(gameId, goalData);

      // Sync state from response
      goalCountRef.current = g.goal_count;
      setScoreA(g.score_a);
      setScoreB(g.score_b);

      if (g.state === "completed") {
        setWinner(g.winner as Side | null);
        setPhase("completed");
      }
    } catch (e) {
      console.error("Failed to save goal:", e);
    }
  }, [postGoal, gameId, attrSide, friendlyFire, scoreA, scoreB, remotePlayers, sideA, sideB]);

  /* ── undo goal ── */
  const undoGoal = useCallback(
    async (side: Side) => {
      if (phase !== "active" || !gameId) return;

      // Find the last goal on the given side to delete
      const lastGame = await fetchGame(gameId);
      const sideGoals = lastGame.goals.filter((g) => g.side === side);
      const lastGoal = sideGoals[sideGoals.length - 1];
      if (!lastGoal) return;

      // Optimistic UI update
      const newA = side === "a" ? Math.max(0, scoreA - 1) : scoreA;
      const newB = side === "b" ? Math.max(0, scoreB - 1) : scoreB;
      setScoreA(newA);
      setScoreB(newB);

      try {
        const g = await removeGoal(gameId, lastGoal.id);
        goalCountRef.current = g.goal_count;
        setScoreA(g.score_a);
        setScoreB(g.score_b);
      } catch (e) {
        console.error("Failed to undo goal:", e);
      }
    },
    [phase, fetchGame, removeGoal, gameId, scoreA, scoreB],
  );

  /* ── play again → back to setup ── */
  const resetToSetup = useCallback(() => {
    setGameId(null);
    setScoreA(0);
    setScoreB(0);
    setElapsed(0);
    setWinner(null);
    setLastGoalSide(null);
    setLastGoalFF(false);
    setLastGoalScorer(null);
    setRemotePlayers([]);
    goalCountRef.current = 0;
    setPhase("setup");
  }, []);

  /* ── auto-detect new active game (works across devices) — group context only ── */
  useEffect(() => {
    if (isTournamentGame || !groupId) return;
    if (phase !== "setup" && phase !== "completed" && phase !== "cancelled") return;

    const poll = setInterval(async () => {
      try {
        const active = await getActiveGame(groupId);
        if (active && active.id !== gameId) {
          // A new game was started (possibly on another device) — join it
          setGameId(active.id);
          setScoreA(active.score_a);
          setScoreB(active.score_b);
          setElapsed(active.elapsed);
          setWinner(active.winner as Side | null);
          setRemotePlayers(active.players);
          setGoalsToWin(active.goals_to_win ?? 10);
          setWinBy(active.win_by ?? 2);
          goalCountRef.current = active.goal_count ?? 0;
          serverElapsedRef.current = active.elapsed;
          serverFetchedAtRef.current = Date.now();
          setPhase(active.state as PagePhase);
        }
      } catch {
        // ignore
      }
    }, SYNC_INTERVAL_MS);

    return () => clearInterval(poll);
  }, [isTournamentGame, groupId, gameId, phase]);

  const isActive = phase === "active";
  const isPaused = phase === "paused";
  const isCompleted = phase === "completed";
  const isCancelled = phase === "cancelled";

  /* ── shared side-picker UI (used in setup + post-game) ── */
  const renderSidePicker = (actionLabel: string, onAction: () => void) => (
    <>
      <img src={vsBadge} alt="VS" className="gp-idle-badge" />
      <h1 className="gp-idle-title">Pick Sides</h1>
      <p className="gp-idle-sub">
        {isTournamentGame
          ? <>Teams are pre-assigned from the bracket.<br />First to {goalsToWin} · win by {winBy}.</>
          : <>Assign group members to Side&nbsp;A or Side&nbsp;B.<br />First to {goalsToWin} · win by {winBy}.</>
        }
      </p>

      <div className="gp-team-picker">
        {/* Side A */}
        <div className="gp-pick-side gp-pick-side--a">
          <h3 className="gp-pick-side-title gp-pick-side-title--a">Side A</h3>
          <div className="gp-pick-list">
            <AnimatePresence initial={false}>
            {sideA.map((m) => (
              <motion.div
                key={m.key}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                style={{ overflow: "hidden" }}
              >
                <button
                  className="gp-pick-chip gp-pick-chip--a"
                  onClick={() => !isTournamentGame && unassignPlayer(m)}
                  title={isTournamentGame ? m.name : "Remove from Side A"}
                  style={isTournamentGame ? { cursor: "default" } : undefined}
                >
                  <UserAvatar name={m.name} imageUrl={m.image_url} className="gp-pick-avatar-wrap" fallbackClassName="text-[10px]" />
                  <span>{m.name}</span>
                  {!isTournamentGame && <span className="gp-pick-x">✕</span>}
                </button>
              </motion.div>
            ))}
            </AnimatePresence>
            {sideA.length === 0 && (
              <p className="gp-pick-empty">Tap a player below to add</p>
            )}
          </div>
        </div>

        {/* Side B */}
        <div className="gp-pick-side gp-pick-side--b">
          <h3 className="gp-pick-side-title gp-pick-side-title--b">Side B</h3>
          <div className="gp-pick-list">
            <AnimatePresence initial={false}>
            {sideB.map((m) => (
              <motion.div
                key={m.key}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                style={{ overflow: "hidden" }}
              >
                <button
                  className="gp-pick-chip gp-pick-chip--b"
                  onClick={() => !isTournamentGame && unassignPlayer(m)}
                  title={isTournamentGame ? m.name : "Remove from Side B"}
                  style={isTournamentGame ? { cursor: "default" } : undefined}
                >
                  <UserAvatar name={m.name} imageUrl={m.image_url} className="gp-pick-avatar-wrap" fallbackClassName="text-[10px]" />
                  <span>{m.name}</span>
                  {!isTournamentGame && <span className="gp-pick-x">✕</span>}
                </button>
              </motion.div>
            ))}
            </AnimatePresence>
            {sideB.length === 0 && (
              <p className="gp-pick-empty">Tap a player below to add</p>
            )}
          </div>
        </div>
      </div>

      {/* Action row: Auto Balance + Start/Play Again */}
      <div className="gp-action-row">
        {!isTournamentGame && (
          <button
            className="gp-btn gp-btn--balance"
            onClick={autoBalance}
            disabled={sideA.length + sideB.length < 2}
            title="Auto-balance teams by skill rating"
          >
            <Sparkles className="gp-sparkle-icon" />
            Auto Balance
            {balanceInfo && (
              <span className="gp-balance-dot" style={{ background: balanceInfo.color }} />
            )}
          </button>
        )}

        <button
          className="gp-btn gp-btn--primary"
          onClick={onAction}
          disabled={sideA.length === 0 || sideB.length === 0 || saving}
        >
          {saving ? "Starting…" : actionLabel}
        </button>
      </div>

      {/* Unassigned players — group context only */}
      {!isTournamentGame && unassigned.length > 0 && (
        <div className="gp-unassigned">
          <h4 className="gp-unassigned-title">Available Players</h4>
          <div className="gp-unassigned-list">
            <AnimatePresence initial={false}>
            {unassigned.map((m) => (
              <motion.div
                key={m.key}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                style={{ overflow: "hidden" }}
              >
                <div className="gp-unassigned-player">
                <UserAvatar name={m.name} imageUrl={m.image_url} className="gp-pick-avatar-wrap" fallbackClassName="text-[10px]" />
                <span className="gp-unassigned-name">{m.name}</span>
                <button
                  className="gp-assign-btn gp-assign-btn--a"
                  onClick={() => assignPlayer(m, "a")}
                >
                  → A
                </button>
                <button
                  className="gp-assign-btn gp-assign-btn--b"
                  onClick={() => assignPlayer(m, "b")}
                >
                  → B
                </button>
                </div>
              </motion.div>
            ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {isTournamentGame ? (
        <Link to={`/tournament/${slug}`} className="gp-btn">
          ← Back to Tournament
        </Link>
      ) : (
        <Link to={`/group/${groupId}`} className="gp-btn">
          ← Back to Group
        </Link>
      )}
    </>
  );

  /* ── progress toward win ── */
  const maxScore = Math.max(scoreA, scoreB, goalsToWin);
  const progressA = maxScore > 0 ? (scoreA / maxScore) * 50 : 0;
  const progressB = maxScore > 0 ? (scoreB / maxScore) * 50 : 0;

  /* ── player names for side labels ── */
  const sideAPlayers = phase === "setup" ? sideA : remotePlayers.filter((p) => p.side === "a");
  const sideBPlayers = phase === "setup" ? sideB : remotePlayers.filter((p) => p.side === "b");
  const sideALabel =
    sideAPlayers.length > 0
      ? sideAPlayers.map((p) => p.name).join(", ")
      : "Side A";
  const sideBLabel =
    sideBPlayers.length > 0
      ? sideBPlayers.map((p) => p.name).join(", ")
      : "Side B";

  /* ── loading ── */
  if (phase === "loading") {
    return (
      <div className="gp">
        {/* iOS Safari: extend bg behind browser chrome */}
        <div className="gp-ios-shim" aria-hidden>
          <div className="gp-ios-shim-inner" />
        </div>
        <div className="gp-bg" style={{ backgroundImage: `url(${liveBoardBg})` }} />
        <div className="gp-bg-overlay" />
        <div className="gp-idle z-[2]">
          <img src={noActiveGameImg} alt="" className="gp-overlay-img opacity-70" />
          <p className="text-slate-300 text-lg">Loading game…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="gp">
      {/* iOS Safari: extend bg behind browser chrome */}
      <div className="gp-ios-shim" aria-hidden>
        <div className="gp-ios-shim-inner" />
      </div>
      {/* background */}
      <div className="gp-bg" style={{ backgroundImage: `url(${liveBoardBg})` }} />
      <div className="gp-bg-overlay" />

      {/* ────── PHASE PANELS (mutually exclusive) ────── */}
      <AnimatePresence mode="wait">
        {phase === "setup" && (
          <motion.div
            key="setup"
            className="gp-setup"
            variants={phaseFade}
            initial="hidden"
            animate="show"
            exit="exit"
          >
            {renderSidePicker("Start Match", isTournamentGame ? startTournamentGame : startGame)}
          </motion.div>
        )}

        {(isActive || isPaused) && (
          <motion.div
            key="board"
            className="gp-board"
            variants={phaseFade}
            initial="hidden"
            animate="show"
            exit="exit"
          >
            {/* timer */}
            <div className="gp-timer">{formatTime(elapsed)}</div>

            {/* top bar */}
            <div className="gp-topbar">
              <motion.button
                className="gp-topbar-btn"
                whileTap={{ scale: 0.9 }}
                onClick={togglePause}
              >
                {isPaused ? "▶ Resume" : "⏸ Pause"}
              </motion.button>
              <span className="gp-topbar-label">
                First to {goalsToWin} · Win by {winBy}
              </span>
              <motion.button
                className="gp-topbar-btn gp-topbar-btn--danger"
                whileTap={{ scale: 0.9 }}
                onClick={cancelGame}
              >
                ✕ Cancel
              </motion.button>
            </div>

            {/* scoreboard */}
            <div className="gp-scores">
              {/* Side A */}
              <div
                className="gp-side gp-side--a gp-side--clickable"
                onClick={() => isActive && openGoalDialog("a")}
              >
                <img src={sideABanner} alt="" className="gp-side-bg" />
                <span className="gp-side-label">{sideALabel}</span>
                <motion.span
                  className="gp-side-num"
                  key={`a-${scoreA}`}
                  variants={scoreBump}
                  animate="bump"
                >
                  {scoreA}
                </motion.span>
                {/* player avatars */}
                <div className="gp-side-players">
                  {sideAPlayers.map((p, i) => (
                    <UserAvatar
                      key={p.user_id ?? `a-avatar-${i}`}
                      name={p.name}
                      imageUrl={p.image_url}
                      className="gp-side-player-avatar-wrap"
                      fallbackClassName="text-[10px]"
                    />
                  ))}
                </div>
                <div className="gp-goal-area">
                  <img src={scoreBtnA} alt="Goal A" className="gp-goal-icon" />
                  <span className="gp-goal-label">TAP TO SCORE</span>
                </div>
                <button
                  className="gp-undo"
                  onClick={(e) => { e.stopPropagation(); undoGoal("a"); }}
                  disabled={!isActive || scoreA === 0}
                >
                  ↩ Undo
                </button>
              </div>

              {/* VS */}
              <div className="gp-vs">
                <img src={vsBadge} alt="VS" className="gp-vs-img" />
              </div>

              {/* Side B */}
              <div
                className="gp-side gp-side--b gp-side--clickable"
                onClick={() => isActive && openGoalDialog("b")}
              >
                <img src={sideBBanner} alt="" className="gp-side-bg" />
                <span className="gp-side-label">{sideBLabel}</span>
                <motion.span
                  className="gp-side-num"
                  key={`b-${scoreB}`}
                  variants={scoreBump}
                  animate="bump"
                >
                  {scoreB}
                </motion.span>
                {/* player avatars */}
                <div className="gp-side-players">
                  {sideBPlayers.map((p, i) => (
                    <UserAvatar
                      key={p.user_id ?? `b-avatar-${i}`}
                      name={p.name}
                      imageUrl={p.image_url}
                      className="gp-side-player-avatar-wrap"
                      fallbackClassName="text-[10px]"
                    />
                  ))}
                </div>
                <div className="gp-goal-area">
                  <img src={scoreBtnB} alt="Goal B" className="gp-goal-icon" />
                  <span className="gp-goal-label">TAP TO SCORE</span>
                </div>
                <button
                  className="gp-undo"
                  onClick={(e) => { e.stopPropagation(); undoGoal("b"); }}
                  disabled={!isActive || scoreB === 0}
                >
                  ↩ Undo
                </button>
              </div>
            </div>

            {/* progress */}
            <div className="gp-progress">
              <motion.div
                className="gp-prog-fill gp-prog-fill--a"
                animate={{ width: `${progressA}%` }}
                transition={{ type: "spring" as const, stiffness: 300, damping: 25 }}
              />
              <motion.div
                className="gp-prog-fill gp-prog-fill--b ml-auto"
                animate={{ width: `${progressB}%` }}
                transition={{ type: "spring" as const, stiffness: 300, damping: 25 }}
              />
            </div>
          </motion.div>
        )}

        {(isCompleted || isCancelled) && (
          <motion.div
            key="finished"
            className="gp-setup"
            variants={phaseFade}
            initial="hidden"
            animate="show"
            exit="exit"
          >
            {/* Result banner */}
            {isCompleted && winner && (
              <>
                <motion.img
                  src={winner === "a" ? victoryBanner : defeatBanner}
                  alt="Banner"
                  className="gp-result-banner"
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring" as const, stiffness: 260, damping: 20 }}
                />
                <motion.h2
                  className="gp-result-title"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  {winner === "a" ? sideALabel : sideBLabel} Wins!
                </motion.h2>
                <motion.p
                  className="gp-result-final"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.35 }}
                >
                  {scoreA} – {scoreB} · {formatTime(elapsed)}
                </motion.p>
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                >
                  {isTournamentGame ? (
                    <Link to={`/tournament/${slug}`} className="gp-btn gp-btn--primary">
                      Back to Tournament
                    </Link>
                  ) : (
                    <Link to={`/leaderboard/${groupId}`} className="gp-btn gp-btn--primary">
                      Go to Leaderboard
                    </Link>
                  )}
                </motion.div>
              </>
            )}
            {isCancelled && (
              <>
                <img src={gameCancelledImg} alt="Cancelled" className="gp-overlay-img w-[120px] mb-2" />
                <h2 className="gp-overlay-heading">Game Cancelled</h2>
                <p className="gp-overlay-sub mb-4">
                  {scoreA} – {scoreB} · {formatTime(elapsed)}
                </p>
              </>
            )}

            {/* Pick Sides (reused) — or return for tournament */}
            {isTournamentGame ? (
              !isCompleted && (
                <Link to={`/tournament/${slug}`} className="gp-btn gp-btn--primary" style={{ marginTop: "1rem" }}>
                  Back to Tournament
                </Link>
              )
            ) : (
              renderSidePicker("Play Again", () => { resetToSetup(); startGame(); })
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ────── GOAL ATTRIBUTION DIALOG ────── */}
      <AnimatePresence>
        {showAttribution && (
          <motion.div
            key="attr"
            className="gp-attr-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowAttribution(false)}
          >
            <motion.div
              className="gp-attr-sheet"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring" as const, stiffness: 340, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="gp-attr-handle" />
              <h3 className="gp-attr-title">
                Goal for {attrSide === "a" ? sideALabel : sideBLabel}
              </h3>

              {/* Friendly Fire toggle */}
              <button
                className={`gp-ff-toggle ${friendlyFire ? "gp-ff-toggle--on" : ""}`}
                onClick={() => setFriendlyFire((f) => !f)}
              >
                <span className="gp-ff-dot" />
                <span>Friendly Fire (own goal)</span>
              </button>

              {friendlyFire && (
                <p className="gp-ff-hint">
                  Point goes to {attrSide === "a" ? sideBLabel : sideALabel} instead.
                </p>
              )}

              {/* Scorer selection — tapping a player instantly records the goal */}
              <h4 className="gp-scorer-title">Who scored?</h4>
              <div className="gp-scorer-list">
                {(() => {
                  // Show players from the side that performed the action
                  const players: PlayerInfo[] = remotePlayers.length > 0
                    ? remotePlayers.filter((p) => p.side === attrSide).map((p, i) => ({ key: p.user_id ?? `${p.name}-${i}`, user_id: p.user_id, name: p.name, image_url: p.image_url }))
                    : (attrSide === "a" ? sideA : sideB);
                  return players.map((p, i) => {
                    return (
                      <button
                        key={p.user_id ?? `scorer-${i}`}
                        className="gp-scorer-btn"
                        onClick={() => confirmGoal(p.user_id, p.name)}
                      >
                        <UserAvatar
                          name={p.name}
                          imageUrl={p.image_url}
                          className="gp-scorer-avatar-wrap"
                          fallbackClassName="text-xs"
                        />
                        <span className="gp-scorer-name">{p.name}</span>
                      </button>
                    );
                  });
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ────── GOAL SPLASH ────── */}
      <AnimatePresence>
        {isActive && lastGoalSide && (
          <motion.div
            key={`goal-${goalKey}`}
            className="gp-splash"
            variants={popIn}
            initial="hidden"
            animate="show"
            exit="exit"
          >
            <img
              src={lastGoalFF ? friendlyFireSplash : goalSplash}
              alt={lastGoalFF ? "Friendly Fire!" : "GOAL!"}
              className="gp-splash-img"
            />
            {lastGoalScorer && (
              <span className="gp-splash-scorer">{lastGoalScorer}</span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ────── PAUSE OVERLAY ────── */}
      <AnimatePresence>
        {isPaused && (
          <motion.div
            key="pause"
            className="gp-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <img src={pauseOverlay} alt="Paused" className="gp-overlay-img" />
            <h2 className="gp-overlay-heading">Game Paused</h2>
            <p className="gp-overlay-time">{formatTime(elapsed)}</p>
            <button className="gp-btn gp-btn--primary" onClick={togglePause}>
              Resume
            </button>
          </motion.div>
        )}
      </AnimatePresence>


    </div>
  );
}

export default GamePage;
