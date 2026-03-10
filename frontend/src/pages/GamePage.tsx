import { useState, useCallback, useEffect, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { pageVariants, popIn } from "@/lib/animations";
import {
  getGroup,
  getActiveGame,
  createGame,
  updateGame,
  getGame,
  recordGoal,
  resolveImageUrl,
  type GroupDetail,
  type GroupMember as GroupMemberType,
  type GameResponse,
  type GamePlayer,
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

const SCORE_THRESHOLD = 10;
const WIN_MARGIN = 2;
const SYNC_INTERVAL_MS = 2000;

/* ── helpers ── */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/* ── animation variants ── */
const fadeIn = pageVariants;

const scoreBump = {
  bump: {
    scale: [1, 1.4, 1],
    transition: { duration: 0.35 },
  },
};

/* ── component ── */
function GamePage() {
  const { groupId } = useParams<{ groupId: string }>();

  // group data
  const [, setGroup] = useState<GroupDetail | null>(null);
  const [phase, setPhase] = useState<PagePhase>("loading");

  // setup: player assignment
  const [sideA, setSideA] = useState<GroupMemberType[]>([]);
  const [sideB, setSideB] = useState<GroupMemberType[]>([]);
  const [unassigned, setUnassigned] = useState<GroupMemberType[]>([]);

  // game state (synced with backend)
  const [gameId, setGameId] = useState<string | null>(null);
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [winner, setWinner] = useState<Side | null>(null);
  const [remotePlayers, setRemotePlayers] = useState<GameResponse["players"]>([]);

  // UI state
  const [lastGoalSide, setLastGoalSide] = useState<Side | null>(null);
  const [lastGoalFF, setLastGoalFF] = useState(false);
  const [lastGoalScorer, setLastGoalScorer] = useState<string | null>(null);
  const [goalKey, setGoalKey] = useState(0);
  const [showAttribution, setShowAttribution] = useState(false);
  const [attrSide, setAttrSide] = useState<Side>("a");
  const [friendlyFire, setFriendlyFire] = useState(false);
  const [saving, setSaving] = useState(false);
  const [, setRemoteGoalCount] = useState(0);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const goalCountRef = useRef(0);
  // Server-synced elapsed: base value from last poll + local wall-clock delta
  const serverElapsedRef = useRef(0);
  const serverFetchedAtRef = useRef(0);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  /* ── screen wake lock: keep screen on during active game ── */
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
    if (!groupId) return;
    (async () => {
      try {
        // Always load group data first
        const groupData = await getGroup(groupId);
        setGroup(groupData);

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
          goalCountRef.current = activeGame.goal_count ?? 0;
          setRemoteGoalCount(activeGame.goal_count ?? 0);
          serverElapsedRef.current = activeGame.elapsed;
          serverFetchedAtRef.current = Date.now();

          const assignedIds = new Set(activeGame.players.map((p) => p.user_id));
          const sA = activeGame.players
            .filter((p) => p.side === "a")
            .map((p) => groupData.members.find((m) => m.user_id === p.user_id))
            .filter(Boolean) as GroupMemberType[];
          const sB = activeGame.players
            .filter((p) => p.side === "b")
            .map((p) => groupData.members.find((m) => m.user_id === p.user_id))
            .filter(Boolean) as GroupMemberType[];
          setSideA(sA);
          setSideB(sB);
          setUnassigned(groupData.members.filter((m) => !assignedIds.has(m.user_id)));

          setPhase(activeGame.state as PagePhase);
        } else {
          setUnassigned(groupData.members);
          setPhase("setup");
        }
      } catch {
        setPhase("setup");
      }
    })();
  }, [groupId]);

  /* ── timer (display only — derives from server elapsed + local delta) ── */
  useEffect(() => {
    if (phase === "active") {
      timerRef.current = setInterval(() => {
        const localDelta = Math.floor((Date.now() - serverFetchedAtRef.current) / 1000);
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
    if (!groupId || !gameId) return;
    if (phase !== "active" && phase !== "paused" && phase !== "setup") return;

    syncRef.current = setInterval(async () => {
      try {
        const g = await getGame(groupId, gameId);
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
          setRemoteGoalCount(g.goal_count);

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
  }, [groupId, gameId, phase]);

  /* ── setup: assign player to side ── */
  const assignPlayer = useCallback((member: GroupMemberType, side: Side) => {
    setUnassigned((prev) => prev.filter((m) => m.user_id !== member.user_id));
    setSideA((prev) => prev.filter((m) => m.user_id !== member.user_id));
    setSideB((prev) => prev.filter((m) => m.user_id !== member.user_id));
    if (side === "a") {
      setSideA((prev) => [...prev, member]);
    } else {
      setSideB((prev) => [...prev, member]);
    }
  }, []);

  const unassignPlayer = useCallback((member: GroupMemberType) => {
    setSideA((prev) => prev.filter((m) => m.user_id !== member.user_id));
    setSideB((prev) => prev.filter((m) => m.user_id !== member.user_id));
    setUnassigned((prev) => [...prev, member]);
  }, []);

  /* ── start game (create on server) ── */
  const startGame = useCallback(async () => {
    if (!groupId || sideA.length === 0 || sideB.length === 0) return;
    setSaving(true);
    try {
      const game = await createGame(
        groupId,
        sideA.map((m) => m.user_id),
        sideB.map((m) => m.user_id),
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
      setRemoteGoalCount(0);

      await updateGame(groupId, game.id, { state: "active" });
      setPhase("active");
    } catch (e) {
      console.error("Failed to start game:", e);
    } finally {
      setSaving(false);
    }
  }, [groupId, sideA, sideB]);

  /* ── toggle pause ── */
  const togglePause = useCallback(async () => {
    if (!groupId || !gameId) return;
    const newState = phase === "active" ? "paused" : "active";
    try {
      await updateGame(groupId, gameId, {
        state: newState,
      });
      setPhase(newState);
    } catch (e) {
      console.error("Failed to toggle pause:", e);
    }
  }, [groupId, gameId, phase]);

  /* ── cancel game ── */
  const cancelGame = useCallback(async () => {
    if (!groupId || !gameId) return;
    try {
      await updateGame(groupId, gameId, {
        state: "cancelled",
      });
      setPhase("cancelled");
    } catch (e) {
      console.error("Failed to cancel game:", e);
    }
  }, [groupId, gameId]);

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
  const confirmGoal = useCallback(async (scorerId: string) => {
    if (!groupId || !gameId) return;

    const scoringSide = friendlyFire ? (attrSide === "a" ? "b" : "a") : attrSide;

    const newA = scoringSide === "a" ? scoreA + 1 : scoreA;
    const newB = scoringSide === "b" ? scoreB + 1 : scoreB;

    // Find scorer name for splash
    const allPlayers = remotePlayers.length > 0 ? remotePlayers : [...sideA, ...sideB];
    const scorerPlayer = allPlayers.find((p) => p.user_id === scorerId);
    const scorerName = scorerPlayer ? ("name" in scorerPlayer ? scorerPlayer.name : "") : "";

    setScoreA(newA);
    setScoreB(newB);
    setLastGoalSide(scoringSide);
    setLastGoalFF(friendlyFire);
    setLastGoalScorer(scorerName);
    setGoalKey((k) => k + 1);
    setShowAttribution(false);

    // Update local goal count so we don't re-trigger splash on sync
    goalCountRef.current += 1;
    setRemoteGoalCount(goalCountRef.current);

    try {
      const g = await recordGoal(groupId, gameId, {
        scored_by: scorerId,
        side: scoringSide,
        friendly_fire: friendlyFire,
        elapsed_at: elapsed,
      });

      // Sync state from response
      goalCountRef.current = g.goal_count;
      setRemoteGoalCount(g.goal_count);
      setScoreA(g.score_a);
      setScoreB(g.score_b);

      if (g.state === "completed") {
        setWinner(g.winner as Side | null);
        setPhase("completed");
      }
    } catch (e) {
      console.error("Failed to save goal:", e);
    }
  }, [groupId, gameId, attrSide, friendlyFire, scoreA, scoreB, remotePlayers, sideA, sideB]);

  /* ── undo goal ── */
  const undoGoal = useCallback(
    async (side: Side) => {
      if (phase !== "active" || !groupId || !gameId) return;
      const newA = side === "a" ? Math.max(0, scoreA - 1) : scoreA;
      const newB = side === "b" ? Math.max(0, scoreB - 1) : scoreB;
      setScoreA(newA);
      setScoreB(newB);
      try {
        await updateGame(groupId, gameId, {
          score_a: newA,
          score_b: newB,
        });
      } catch (e) {
        console.error("Failed to undo goal:", e);
      }
    },
    [phase, groupId, gameId, scoreA, scoreB],
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
    setRemoteGoalCount(0);
    setPhase("setup");
  }, []);

  /* ── auto-detect new active game (works across devices) ── */
  useEffect(() => {
    if (!groupId) return;
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
          goalCountRef.current = active.goal_count ?? 0;
          setRemoteGoalCount(active.goal_count ?? 0);
          serverElapsedRef.current = active.elapsed;
          serverFetchedAtRef.current = Date.now();
          setPhase(active.state as PagePhase);
        }
      } catch {
        // ignore
      }
    }, SYNC_INTERVAL_MS);

    return () => clearInterval(poll);
  }, [groupId, gameId, phase]);

  const isActive = phase === "active";
  const isPaused = phase === "paused";
  const isCompleted = phase === "completed";
  const isCancelled = phase === "cancelled";

  /* ── progress toward win ── */
  const maxScore = Math.max(scoreA, scoreB, SCORE_THRESHOLD);
  const progressA = maxScore > 0 ? (scoreA / maxScore) * 50 : 0;
  const progressB = maxScore > 0 ? (scoreB / maxScore) * 50 : 0;

  /* ── player names for side labels ── */
  const sideAPlayers = phase === "setup" ? sideA : remotePlayers.filter((p) => p.side === "a");
  const sideBPlayers = phase === "setup" ? sideB : remotePlayers.filter((p) => p.side === "b");
  const sideALabel =
    sideAPlayers.length > 0
      ? sideAPlayers.map((p) => ("name" in p ? p.name : "")).join(", ")
      : "Side A";
  const sideBLabel =
    sideBPlayers.length > 0
      ? sideBPlayers.map((p) => ("name" in p ? p.name : "")).join(", ")
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
        <div className="gp-idle" style={{ zIndex: 2 }}>
          <img src={noActiveGameImg} alt="" className="gp-overlay-img" style={{ opacity: 0.7 }} />
          <p style={{ color: "#cbd5e1", fontSize: "1.1rem" }}>Loading game…</p>
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

      {/* ────── SETUP: SIDE SELECTION ────── */}
      <AnimatePresence mode="wait">
        {phase === "setup" && (
          <motion.div
            key="setup"
            className="gp-setup"
            variants={fadeIn}
            initial="hidden"
            animate="show"
            exit="exit"
          >
            <img src={vsBadge} alt="VS" className="gp-idle-badge" />
            <h1 className="gp-idle-title">Pick Sides</h1>
            <p className="gp-idle-sub">
              Assign group members to Side&nbsp;A or Side&nbsp;B.
              <br />
              First to {SCORE_THRESHOLD} · win by {WIN_MARGIN}.
            </p>

            <div className="gp-team-picker">
              {/* Side A */}
              <div className="gp-pick-side gp-pick-side--a">
                <h3 className="gp-pick-side-title gp-pick-side-title--a">Side A</h3>
                <div className="gp-pick-list">
                  {sideA.map((m) => (
                    <button
                      key={m.user_id}
                      className="gp-pick-chip gp-pick-chip--a"
                      onClick={() => unassignPlayer(m)}
                      title="Remove from Side A"
                    >
                      {m.image_url ? (
                        <img
                          src={resolveImageUrl(m.image_url) ?? ""}
                          alt={m.name}
                          className="gp-pick-avatar"
                        />
                      ) : (
                        <div className="gp-pick-avatar gp-pick-avatar--empty" />
                      )}
                      <span>{m.name}</span>
                      <span className="gp-pick-x">✕</span>
                    </button>
                  ))}
                  {sideA.length === 0 && (
                    <p className="gp-pick-empty">Tap a player below to add</p>
                  )}
                </div>
              </div>

              {/* Side B */}
              <div className="gp-pick-side gp-pick-side--b">
                <h3 className="gp-pick-side-title gp-pick-side-title--b">Side B</h3>
                <div className="gp-pick-list">
                  {sideB.map((m) => (
                    <button
                      key={m.user_id}
                      className="gp-pick-chip gp-pick-chip--b"
                      onClick={() => unassignPlayer(m)}
                      title="Remove from Side B"
                    >
                      {m.image_url ? (
                        <img
                          src={resolveImageUrl(m.image_url) ?? ""}
                          alt={m.name}
                          className="gp-pick-avatar"
                        />
                      ) : (
                        <div className="gp-pick-avatar gp-pick-avatar--empty" />
                      )}
                      <span>{m.name}</span>
                      <span className="gp-pick-x">✕</span>
                    </button>
                  ))}
                  {sideB.length === 0 && (
                    <p className="gp-pick-empty">Tap a player below to add</p>
                  )}
                </div>
              </div>
            </div>

            {/* Unassigned players */}
            {unassigned.length > 0 && (
              <div className="gp-unassigned">
                <h4 className="gp-unassigned-title">Available Players</h4>
                <div className="gp-unassigned-list">
                  {unassigned.map((m) => (
                    <div key={m.user_id} className="gp-unassigned-player">
                      {m.image_url ? (
                        <img
                          src={resolveImageUrl(m.image_url) ?? ""}
                          alt={m.name}
                          className="gp-pick-avatar"
                        />
                      ) : (
                        <div className="gp-pick-avatar gp-pick-avatar--empty" />
                      )}
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
                  ))}
                </div>
              </div>
            )}

            <motion.button
              className="gp-start-btn"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={startGame}
              disabled={sideA.length === 0 || sideB.length === 0 || saving}
              style={{
                opacity: sideA.length === 0 || sideB.length === 0 ? 0.4 : 1,
              }}
            >
              {saving ? "Creating…" : "Start Match"}
            </motion.button>

            <Link to={`/group/${groupId}`} className="gp-back-link">
              ← Back to Group
            </Link>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ────── ACTIVE / PAUSED ────── */}
      <AnimatePresence>
        {(isActive || isPaused) && (
          <motion.div
            key="board"
            className="gp-board"
            variants={fadeIn}
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
                First to {SCORE_THRESHOLD} · Win by {WIN_MARGIN}
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
                  {sideAPlayers.map((p) => {
                    const imgUrl = resolveImageUrl(p.image_url);
                    const name = "name" in p ? p.name : "";
                    return imgUrl ? (
                      <img
                        key={p.user_id}
                        src={imgUrl}
                        alt={name}
                        className="gp-side-player-avatar"
                        title={name}
                      />
                    ) : (
                      <div
                        key={p.user_id}
                        className="gp-side-player-avatar gp-side-player-avatar--empty"
                        title={name}
                      />
                    );
                  })}
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
                  {sideBPlayers.map((p) => {
                    const imgUrl = resolveImageUrl(p.image_url);
                    const name = "name" in p ? p.name : "";
                    return imgUrl ? (
                      <img
                        key={p.user_id}
                        src={imgUrl}
                        alt={name}
                        className="gp-side-player-avatar"
                        title={name}
                      />
                    ) : (
                      <div
                        key={p.user_id}
                        className="gp-side-player-avatar gp-side-player-avatar--empty"
                        title={name}
                      />
                    );
                  })}
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
                className="gp-prog-fill gp-prog-fill--b"
                style={{ marginLeft: "auto" }}
                animate={{ width: `${progressB}%` }}
                transition={{ type: "spring" as const, stiffness: 300, damping: 25 }}
              />
            </div>
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
                  const players: (GamePlayer | GroupMemberType)[] = remotePlayers.length > 0
                    ? remotePlayers.filter((p) => p.side === attrSide)
                    : (attrSide === "a" ? sideA : sideB);
                  return players.map((p) => {
                    const imgUrl = resolveImageUrl(p.image_url);
                    const name = "name" in p ? p.name : "";
                    return (
                      <button
                        key={p.user_id}
                        className="gp-scorer-btn"
                        onClick={() => confirmGoal(p.user_id)}
                      >
                        {imgUrl ? (
                          <img src={imgUrl} alt={name} className="gp-scorer-avatar" />
                        ) : (
                          <div className="gp-scorer-avatar gp-scorer-avatar--empty" />
                        )}
                        <span className="gp-scorer-name">{name}</span>
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
            <motion.button
              className="gp-start-btn"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={togglePause}
            >
              Resume
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ────── COMPLETED / CANCELLED: show setup with result banner ────── */}
      <AnimatePresence mode="wait">
        {(isCompleted || isCancelled) && (
          <motion.div
            key="finished"
            className="gp-setup"
            variants={fadeIn}
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
                  <Link
                    to={`/leaderboard/${groupId}`}
                    className="gp-start-btn"
                    style={{ display: "inline-block", textDecoration: "none", marginTop: 12 }}
                  >
                    Go to Leaderboard
                  </Link>
                </motion.div>
              </>
            )}
            {isCancelled && (
              <>
                <img src={gameCancelledImg} alt="Cancelled" className="gp-overlay-img" style={{ width: 120, marginBottom: 8 }} />
                <h2 className="gp-overlay-heading">Game Cancelled</h2>
                <p className="gp-overlay-sub" style={{ marginBottom: 16 }}>
                  {scoreA} – {scoreB} · {formatTime(elapsed)}
                </p>
              </>
            )}

            {/* Pick Sides header */}
            <img src={vsBadge} alt="VS" className="gp-idle-badge" />
            <h1 className="gp-idle-title">Pick Sides</h1>
            <p className="gp-idle-sub">
              Assign group members to Side&nbsp;A or Side&nbsp;B.
              <br />
              First to {SCORE_THRESHOLD} · win by {WIN_MARGIN}.
            </p>

            <div className="gp-team-picker">
              {/* Side A */}
              <div className="gp-pick-side gp-pick-side--a">
                <h3 className="gp-pick-side-title gp-pick-side-title--a">Side A</h3>
                <div className="gp-pick-list">
                  {sideA.map((m) => (
                    <button
                      key={m.user_id}
                      className="gp-pick-chip gp-pick-chip--a"
                      onClick={() => unassignPlayer(m)}
                      title="Remove from Side A"
                    >
                      {m.image_url ? (
                        <img
                          src={resolveImageUrl(m.image_url) ?? ""}
                          alt={m.name}
                          className="gp-pick-avatar"
                        />
                      ) : (
                        <div className="gp-pick-avatar gp-pick-avatar--empty" />
                      )}
                      <span>{m.name}</span>
                      <span className="gp-pick-x">✕</span>
                    </button>
                  ))}
                  {sideA.length === 0 && (
                    <p className="gp-pick-empty">Tap a player below to add</p>
                  )}
                </div>
              </div>

              {/* Side B */}
              <div className="gp-pick-side gp-pick-side--b">
                <h3 className="gp-pick-side-title gp-pick-side-title--b">Side B</h3>
                <div className="gp-pick-list">
                  {sideB.map((m) => (
                    <button
                      key={m.user_id}
                      className="gp-pick-chip gp-pick-chip--b"
                      onClick={() => unassignPlayer(m)}
                      title="Remove from Side B"
                    >
                      {m.image_url ? (
                        <img
                          src={resolveImageUrl(m.image_url) ?? ""}
                          alt={m.name}
                          className="gp-pick-avatar"
                        />
                      ) : (
                        <div className="gp-pick-avatar gp-pick-avatar--empty" />
                      )}
                      <span>{m.name}</span>
                      <span className="gp-pick-x">✕</span>
                    </button>
                  ))}
                  {sideB.length === 0 && (
                    <p className="gp-pick-empty">Tap a player below to add</p>
                  )}
                </div>
              </div>
            </div>

            {/* Unassigned players */}
            {unassigned.length > 0 && (
              <div className="gp-unassigned">
                <h4 className="gp-unassigned-title">Available Players</h4>
                <div className="gp-unassigned-list">
                  {unassigned.map((m) => (
                    <div key={m.user_id} className="gp-unassigned-player">
                      {m.image_url ? (
                        <img
                          src={resolveImageUrl(m.image_url) ?? ""}
                          alt={m.name}
                          className="gp-pick-avatar"
                        />
                      ) : (
                        <div className="gp-pick-avatar gp-pick-avatar--empty" />
                      )}
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
                  ))}
                </div>
              </div>
            )}

            <motion.button
              className="gp-start-btn"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => { resetToSetup(); startGame(); }}
              disabled={sideA.length === 0 || sideB.length === 0 || saving}
              style={{
                opacity: sideA.length === 0 || sideB.length === 0 ? 0.4 : 1,
              }}
            >
              {saving ? "Creating…" : "Play Again"}
            </motion.button>

            <Link to={`/group/${groupId}`} className="gp-back-link">
              ← Back to Group
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default GamePage;
