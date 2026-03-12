-- Migration: Add indexes on foreign key columns for query performance.
-- Run this against the existing database before deploying the new code.
-- These are safe to run on a live database (CREATE INDEX CONCURRENTLY avoids locks).

-- games
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_games_group_id ON games (group_id);

-- game_players
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_game_players_game_id ON game_players (game_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_game_players_user_id ON game_players (user_id);

-- game_goals
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_game_goals_game_id ON game_goals (game_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_game_goals_scored_by ON game_goals (scored_by);

-- elo_history
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_elo_history_game_id ON elo_history (game_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_elo_history_group_id ON elo_history (group_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_elo_history_user_id ON elo_history (user_id);

-- group_members
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_group_members_user_id ON group_members (user_id);
