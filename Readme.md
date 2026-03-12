
# SIU — Someone Is Unbeatable

A mobile-first web app for tracking competitive team games (starting with *Tischkicker*). Users sign in with Google, join groups via invite links, start matches, track goals in real time, and compete on fair, statistically-weighted leaderboards.

---

## Quick Start

### Prerequisites

- Docker & Docker Compose
- A [Google OAuth 2.0](https://console.cloud.google.com/apis/credentials) client ID / secret
- (Optional) A [Gemini API key](https://aistudio.google.com/apikey) for AI-generated player avatars

### Run with Docker Compose

```bash
cp .env.example .env               # fill in your secrets
cp frontend/.env.example frontend/.env.development

docker compose up -d --build        # http://localhost (frontend) + :8000 (API)
```

### Run Locally (without Docker)

**Backend (FastAPI)**

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload       # http://localhost:8000  (docs at /docs)
```

**Frontend (React + Vite)**

```bash
cd frontend
npm install
npm run dev                         # http://localhost:5173
```

---

## Environment Variables

Copy `.env.example` → `.env` and fill in the values:

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 client secret |
| `JWT_SECRET` | Signing key for JWTs — generate with `openssl rand -hex 32` |
| `CORS_ORIGINS` | JSON array of allowed origins |
| `GEMINI_API_KEY` | Google Gemini API key (for AI avatar generation) |
| `DATABASE_URL_READONLY` | (Optional) Separate read-only DB connection URL for the query endpoint |
| `POSTGRES_PASSWORD` | Database password (used in production compose) |

The frontend needs its own env file (`frontend/.env.example` → `frontend/.env.development`):

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Backend API base URL (e.g. `/api/v1`) |
| `VITE_GOOGLE_CLIENT_ID` | Same Google client ID as above |

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React 19 + TypeScript + Vite |
| UI | Radix UI + Tailwind CSS 4 |
| Animations | Framer Motion |
| Backend | FastAPI (Python 3.12) |
| Database | PostgreSQL 16 |
| ORM | SQLAlchemy (async) + asyncpg |
| Auth | Google OAuth 2.0 → JWT |
| AI Avatars | Google Gemini API |
| Deployment | Docker Compose + GitHub Actions |

---

## Project Structure

```
├── .github/workflows/deploy.yml    # CI/CD — deploy on merge to main
├── .env.example                    # Backend environment template
├── docker-compose.yml              # Local development
├── docker-compose.prod.yml         # Production
├── nginx/                          # Host Nginx configs (SSL + reverse proxy)
│
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py                 # FastAPI app, CORS, lifespan
│       ├── config.py               # Pydantic settings (from .env)
│       ├── database.py             # Async SQLAlchemy engine + session
│       ├── models/
│       │   ├── user.py
│       │   ├── group.py            # Groups (teams), memberships, invites
│       │   └── game.py             # Games, players, goals, stats
│       ├── schemas/                # Pydantic request/response schemas
│       │   ├── auth.py
│       │   ├── user.py
│       │   ├── group.py
│       │   └── game.py
│       ├── services/
│       │   └── auth.py             # Google token verification, JWT issuing
│       └── api/
│           ├── deps.py             # Dependency injection (current user, DB session)
│           └── v1/
│               ├── router.py       # Central router
│               ├── auth.py         # Google OAuth endpoints
│               ├── users.py        # User profile CRUD
│               ├── groups.py       # Group CRUD, invites, memberships
│               ├── games.py        # Game lifecycle + goals + leaderboard
│               ├── query.py        # Read-only SQL query endpoint
│               └── images.py       # Image upload/retrieval (Gemini avatars)
│
└── frontend/
    ├── Dockerfile                  # Multi-stage: node build → nginx serve
    ├── nginx.conf                  # Frontend routing (SPA fallback + API proxy)
    ├── .env.example
    └── src/
        ├── App.tsx                 # Routes + lazy loading
        ├── lib/
        │   ├── api.ts              # Axios-based API client
        │   ├── AuthContext.tsx      # Auth state (React Context + localStorage)
        │   ├── animations.ts       # Framer Motion variants
        │   └── utils.ts            # Tailwind merge helper
        ├── components/
        │   ├── ui/                 # Radix-based primitives (button, card, dialog, …)
        │   ├── Hero.tsx            # Landing page hero
        │   ├── Footer.tsx
        │   ├── RequireAuth.tsx     # Auth guard
        │   ├── RequireGroupMember.tsx
        │   ├── LoadingState.tsx
        │   ├── PageTransition.tsx
        │   └── …
        ├── pages/
        │   ├── HomePage.tsx        # Landing page
        │   ├── LoginPage.tsx       # Google Sign-In
        │   ├── DashboardPage.tsx   # Group list + quick actions
        │   ├── GroupPage.tsx       # Group detail, members, invite
        │   ├── JoinGroupPage.tsx   # Accept invite link
        │   ├── GamePage.tsx        # Live game board
        │   ├── LeaderboardPage.tsx # Sortable rankings
        │   ├── PlayerPage.tsx      # Player stats detail
        │   ├── ProfilePage.tsx     # Edit profile
        │   ├── ImprintPage.tsx
        │   ├── PrivacyPage.tsx
        │   └── TermsPage.tsx
        └── assets/                 # Images, icons, logos
```

---

## Authentication

Google Sign-In only — no passwords.

1. User taps "Sign in with Google"
2. Backend verifies the Google ID token, finds or creates a `User`
3. Backend issues a JWT for subsequent API calls
4. Profile (name, avatar) is pre-filled from the Google account

---

## Data Model

```
User
 ├── id, name, imageUrl, email, googleId
 │
 └──< GroupMembership >── Group
      (role: owner | admin | member)    ├── id, name, imageUrl, sportType, inviteCode
                                        │
                                        └──< Game
                                             ├── id, status, scores, timestamps
                                             │
                                             ├──< GamePlayer (user + side A/B)
                                             │
                                             └──< Goal
                                                  ├── scoredByUser, scoringSide
                                                  ├── isFriendlyFire
                                                  └── gameTimeSeconds

PlayerStats (per user × group — computed after each game)
 ├── totals: gamesPlayed, won, lost, goalsScored, goalsConceded, friendlyFires
 ├── rates: winRate, goalsPerGame, friendlyFireRate
 ├── ratings: eloRating, adjustedWinRate (Bayesian)
 └── streaks: currentWinStreak, bestWinStreak
```

### Game State Machine

```
SETUP ──→ ACTIVE ←──→ PAUSED
              │
              ├──→ COMPLETED  (score threshold met)
              └──→ CANCELLED  (manually aborted)
```

### Win Condition (Tischkicker)

- First to **10 points**, must win by **at least 2**
- Valid final scores: 10-0 … 10-8, 11-9, 12-10, …

### Custom SQL Queries

Users can run **read-only** SQL queries against their own group's data via `POST /api/v1/groups/{group_id}/query`.

**Available tables** (automatically scoped to the caller's group):

| Table | Columns |
|---|---|
| `games` | id, state, score_a, score_b, elapsed, winner, goal_count, created_by, created_at, started_at |
| `game_players` | id, game_id, user_id, side |
| `game_goals` | id, game_id, scored_by, side, friendly_fire, elapsed_at, created_at |
| `users` | id, name, image_url |

**Example queries:**

```sql
-- Who has the most friendly-fire goals?
SELECT u.name, COUNT(*) AS own_goals
FROM game_goals gg
JOIN users u ON u.id = gg.scored_by
WHERE gg.friendly_fire = true
GROUP BY u.name
ORDER BY own_goals DESC

-- Best team combination (most wins)
SELECT p1.name || ' & ' || p2.name AS team, COUNT(*) AS wins
FROM games g
JOIN game_players gp1 ON gp1.game_id = g.id
JOIN game_players gp2 ON gp2.game_id = g.id AND gp1.user_id < gp2.user_id AND gp1.side = gp2.side
JOIN users p1 ON p1.id = gp1.user_id
JOIN users p2 ON p2.id = gp2.user_id
WHERE g.state = 'completed' AND g.winner = gp1.side
GROUP BY team
ORDER BY wins DESC
```

**Security model:**
- Queries run in a PostgreSQL `READ ONLY` transaction — writes are impossible
- A CTE preamble shadows all table names so only the caller's group data is visible
- Sensitive columns (email, google_id) are never exposed
- A 5-second statement timeout prevents expensive queries
- Results are capped at 1 000 rows
- Optionally configure `DATABASE_URL_READONLY` to use a DB user with only `SELECT` privileges

### Leaderboard Sorting

| Sort Key | Why It's Fair |
|---|---|
| **Elo Rating** | Adjusts for opponent strength |
| **Adjusted Win Rate** | Bayesian shrinkage prevents 1-game flukes |
| **Goals per Game** | Rate-based, not volume-based |
| **Total Wins** | Rewards dedication |
| **Best Win Streak** | Bragging rights |
| **Friendly Fire Rate** | The shame board 🔥 |

---

## Deployment

### CI/CD

On every push to `main`, a GitHub Actions workflow SSHs into the server, pulls the latest code, and rebuilds the containers:

```yaml
# .github/workflows/deploy.yml
on:
  push:
    branches: [main]
```

**Required GitHub Secrets:**

| Secret | Description |
|--------|-------------|
| `SERVER_HOST` | Server IP |
| `SERVER_USER` | SSH username |
| `SSH_PRIVATE_KEY` | SSH private key |

### Production Setup

The production stack runs via `docker-compose.prod.yml` behind a host Nginx reverse proxy with Let's Encrypt SSL:

```
Internet → Nginx (:443) → Frontend (:3002) + Backend (:8002) → PostgreSQL (:5432)
```

1. Clone the repo to `/opt/siu` on the server
2. Copy `.env.example` → `.env` and fill in production secrets
3. `docker compose -f docker-compose.prod.yml up -d --build`
4. Configure host Nginx using the configs in `nginx/`
5. Obtain SSL certificates with `certbot`

---

## License

All rights reserved.