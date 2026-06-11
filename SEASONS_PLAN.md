# Seasons Feature Implementation Plan

## Context

The SUI app tracks competitive foosball games within groups. Currently all stats are "all-time" or filtered by arbitrary date ranges. The user wants time-bound **seasons** (15/30/45 days) per group, with a **museum** of fun awards when each season completes. This adds a competitive cadence and celebration layer to the app.

---

## Key Design Decisions

### Elo: No Reset Per Season
Elo stays continuous across seasons. Resetting every 15-45 days would prevent convergence. Season leaderboards use **Elo delta** (change during the season) which is already computed by the existing `compute_group_stats()` when given a date range.

### Games Are Not Linked to Seasons
No `season_id` on the `Game` table. A game "belongs" to a season if its `created_at` falls within the season's date range. This reuses the existing date-range filtering in `compute_group_stats()` with zero changes to the stats service.

### Lazy Season Rotation
Seasons rotate on API access (when someone views stats or group detail), not via a background scheduler. This avoids needing a cron job.

---

## Phase 1: Backend Models

### 1.1 Add `season_duration_days` to Group model
**File:** `backend/app/models/group.py`
- Add `season_duration_days: Mapped[int | None] = mapped_column(Integer, nullable=True)` to the `Group` class
- `NULL` = seasons not enabled

### 1.2 Create Season & SeasonAward models
**New file:** `backend/app/models/season.py`

**Season:**
- `id` (UUID PK), `group_id` (FK groups), `season_number` (int)
- `duration_days` (int, CHECK IN 15/30/45), `status` (CHECK IN active/completed)
- `start_date`, `end_date` (DateTime TZ-aware), `created_at`
- Unique constraint on `(group_id, season_number)`
- Relationship: `awards` (cascade delete), `group`

**SeasonAward:**
- `id` (UUID PK), `season_id` (FK seasons), `award_type` (str)
- `user_id` (FK users), `value` (str display), `value_numeric` (float)
- `created_at`
- Unique constraint on `(season_id, award_type)`
- Relationship: `season`, `user` (lazy joined)

### 1.3 Register models
**File:** `backend/app/models/__init__.py`
- Add `from app.models.season import Season, SeasonAward`

---

## Phase 2: Backend Services

### 2.1 Create season service
**New file:** `backend/app/services/season.py`

Core functions:
- `get_active_season(group_id, db)` - fetch active season or None
- `ensure_current_season(group_id, db)` - lazy rotation logic:
  1. If `group.season_duration_days` is NULL, return None
  2. If no active season exists, create Season 1 (start=now, end=now+duration)
  3. If active season expired: mark completed, compute awards, create next season
  4. Handle multi-period gaps: skip empty intermediate seasons (increment `season_number` by elapsed count)
- `compute_season_awards(season, db)` - uses existing `compute_group_stats()` with season date range, then picks winners:
  - `most_goals` - highest `goals_scored`
  - `most_own_goals` - highest `own_goals` (skip if all zero)
  - `best_overall` - highest `elo` (min 5 games in period)
  - `best_growth` - highest positive `elo_delta`
- `enable_seasons(group_id, duration_days, db)` - set duration, create first season
- `disable_seasons(group_id, db)` - set duration to NULL, complete active season
- `list_seasons(group_id, db)` - all seasons ordered by number desc
- `get_season_detail(season_id, db)` - season + eagerly loaded awards

Award calculators structured as a registry list for easy extensibility.

---

## Phase 3: Backend API & Schemas

### 3.1 Create season schemas
**New file:** `backend/app/schemas/season.py`
- `SeasonEnableRequest` - `duration_days: Literal[15, 30, 45]`
- `SeasonResponse` - id, group_id, season_number, duration_days, status, start_date, end_date
- `SeasonAwardResponse` - id, award_type, user_id, user_name, user_image_url, value, value_numeric
- `SeasonDetailResponse(SeasonResponse)` - adds `awards: list[SeasonAwardResponse]`

### 3.2 Update group schemas
**File:** `backend/app/schemas/group.py`
- Add `season_duration_days: int | None = None` to `GroupResponse`

### 3.3 Create season API endpoints
**New file:** `backend/app/api/v1/seasons.py`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/groups/{group_id}/seasons/enable` | Enable seasons (owner only) |
| POST | `/groups/{group_id}/seasons/disable` | Disable seasons (owner only) |
| GET | `/groups/{group_id}/seasons` | List all seasons |
| GET | `/groups/{group_id}/seasons/active` | Get active season (triggers rotation) |
| GET | `/groups/{group_id}/seasons/{season_id}` | Get season detail with awards |
| GET | `/groups/{group_id}/seasons/{season_id}/stats` | Full leaderboard for a past season |

### 3.4 Register router
**File:** `backend/app/api/v1/router.py`
- Import and include the seasons router

### 3.5 Add rotation triggers to existing endpoints
**File:** `backend/app/api/v1/groups.py`
- Call `ensure_current_season()` in `get_group_stats` and `get_group` endpoints
- Update `GroupResponse` construction to include `season_duration_days`

---

## Phase 4: Frontend - API Layer & Leaderboard

### 4.1 Add types and API functions
**File:** `frontend/src/lib/api.ts`
- Add `Season`, `SeasonDetail`, `SeasonAward` TypeScript interfaces
- Add functions: `enableSeasons()`, `disableSeasons()`, `listSeasons()`, `getActiveSeason()`, `getSeasonDetail()`, `getSeasonStats()`

### 4.2 Update LeaderboardPage
**File:** `frontend/src/pages/LeaderboardPage.tsx`
- On mount, fetch active season via `getActiveSeason(groupId)`
- If seasons enabled, add "Current Season" as the default period (uses season's date range)
- Show "Season N - X days remaining" badge when viewing current season
- Add "Past Seasons" link navigating to museum page
- Existing period options (All Time, This Week, etc.) remain available

---

## Phase 5: Frontend - Museum Page

### 5.1 Create SeasonMuseumPage
**New file:** `frontend/src/pages/SeasonMuseumPage.tsx`

**List view** (`/group/:groupId/seasons`):
- Cards for each season, newest first
- Active season card with "Current" badge + countdown
- Completed season cards with award winner previews
- Click completed season -> detail view

**Detail view** (`/group/:groupId/seasons/:seasonId`):
- "Season N Museum" header with date range
- Award cards with icons, winner avatar/name, value (animated with Framer Motion)
- Full leaderboard table below (reuse existing DataTable pattern, fetch stats with season's date range)

### 5.2 Add routes
**File:** `frontend/src/App.tsx`
- Add `/group/:groupId/seasons` and `/group/:groupId/seasons/:seasonId` inside `<RequireAuth>`

---

## Phase 6: Frontend - Season Settings

### 6.1 Add season config to GroupPage
**File:** `frontend/src/pages/GroupPage.tsx`
- If user is group owner, show a settings icon/section
- Dialog to enable seasons (select 15/30/45 days) or disable
- Show current season info if enabled

---

## Files to Create
- `backend/app/models/season.py`
- `backend/app/services/season.py`
- `backend/app/schemas/season.py`
- `backend/app/api/v1/seasons.py`
- `frontend/src/pages/SeasonMuseumPage.tsx`

## Files to Modify
- `backend/app/models/group.py` - add `season_duration_days`
- `backend/app/models/__init__.py` - register Season, SeasonAward
- `backend/app/schemas/group.py` - add `season_duration_days` to response
- `backend/app/api/v1/router.py` - include seasons router
- `backend/app/api/v1/groups.py` - add rotation triggers, update response
- `frontend/src/lib/api.ts` - add season types and API functions
- `frontend/src/pages/LeaderboardPage.tsx` - add "Current Season" period
- `frontend/src/pages/GroupPage.tsx` - add season settings for owner
- `frontend/src/App.tsx` - add museum routes

---

## Verification

1. **Enable seasons** on a group - verify Season 1 is created, leaderboard defaults to "Current Season"
2. **Play games** - verify they appear in season stats
3. **Simulate expiry** (manually set `end_date` in past) - verify rotation creates Season 2 with awards
4. **Museum page** - verify completed seasons show awards and full leaderboard
5. **All Time** view - verify it still includes all historical data
6. **Disable seasons** - verify active season is completed, museum preserves history
7. **Edge cases**: zero-game season (no awards), multi-period gap, single-player group
