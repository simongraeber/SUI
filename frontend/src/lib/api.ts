const API_BASE = import.meta.env.VITE_API_URL ?? "/api/v1";

/**
 * Resolve an image_url (which may be a relative /api/v1/... path) to a full URL.
 * In production the relative path works via nginx proxy.
 * In local dev we need to prefix with the API base.
 */
export function resolveImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  // Already absolute (Google profile pic, data URL, etc.)
  if (url.startsWith("http") || url.startsWith("data:") || url.startsWith("blob:")) return url;
  // Relative API path — prefix with API base (strip /api/v1 suffix since the url already contains it)
  const base = API_BASE.replace(/\/api\/v1$/, "");
  return `${base}${url}`;
}

/* ── helpers ── */
function authHeaders(): HeadersInit {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export class ApiError extends Error {
  status: number;
  constructor(
    status: number,
    message: string,
  ) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

/* ── Auth ── */
export async function loginWithGoogle(idToken: string) {
  return request<{ access_token: string; token_type: string }>("/auth/google", {
    method: "POST",
    body: JSON.stringify({ token: idToken }),
  });
}

export async function loginWithGoogleCode(code: string, redirectUri: string) {
  return request<{ access_token: string; token_type: string }>("/auth/google/code", {
    method: "POST",
    body: JSON.stringify({ code, redirect_uri: redirectUri }),
  });
}

export async function getMe() {
  return request<{
    id: string;
    email: string;
    name: string;
    image_url: string | null;
    created_at: string;
  }>("/users/me");
}

/* ── Groups ── */
export interface GroupSummary {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
  created_at: string;
  member_count: number;
}

export interface GroupMember {
  user_id: string;
  name: string;
  email: string;
  image_url: string | null;
  joined_at: string;
  last_played_at: string | null;
}

export interface GroupDetail extends GroupSummary {
  members: GroupMember[];
}

export async function createGroup(name: string) {
  return request<GroupSummary>("/groups", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function listMyGroups() {
  return request<GroupSummary[]>("/groups");
}

export async function getGroup(groupId: string) {
  return request<GroupDetail>(`/groups/${groupId}`);
}

export async function joinGroup(groupId: string, inviteCode: string) {
  return request<GroupSummary>(`/groups/${groupId}/join`, {
    method: "POST",
    body: JSON.stringify({ invite_code: inviteCode }),
  });
}

export async function leaveGroup(groupId: string) {
  return request<void>(`/groups/${groupId}/leave`, { method: "DELETE" });
}

export async function checkMembership(groupId: string) {
  return request<{ member: boolean }>(`/groups/${groupId}/membership`);
}

/* ── Group Stats ── */
export interface PlayerStats {
  user_id: string;
  name: string;
  image_url: string | null;
  elo: number;
  elo_delta: number;
  provisional: boolean;
  games_played: number;
  wins: number;
  losses: number;
  win_rate: number;
  goals_scored: number;
  goals_conceded: number;
  goal_diff: number;
  goals_per_game: number;
  own_goals: number;
  form: string[];
  streak: { type: string; count: number } | null;
}

export interface LeaderboardSummary {
  highest_rated: { user_id: string; name: string; elo: number } | null;
  top_scorer: { user_id: string; name: string; goals: number } | null;
  hot_streak: { user_id: string; name: string; type: string; count: number } | null;
}

export interface PeriodInfo {
  start: string | null;
  end: string | null;
  label: string;
}

export interface GroupStats {
  period: PeriodInfo;
  total_games: number;
  summary: LeaderboardSummary;
  players: PlayerStats[];
}

export async function getGroupStats(groupId: string, startDate?: string, endDate?: string) {
  const params = new URLSearchParams();
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);
  const qs = params.toString();
  return request<GroupStats>(`/groups/${groupId}/stats${qs ? `?${qs}` : ""}`);
}

/* ── Profile ── */
export async function updateMe(data: { name?: string; image_url?: string | null }) {
  return request<{
    id: string;
    email: string;
    name: string;
    image_url: string | null;
    created_at: string;
  }>("/users/me", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/* ── Games ── */
export interface GamePlayer {
  user_id: string | null;
  name: string;
  image_url: string | null;
  side: "a" | "b";
}

export interface GameGoal {
  id: string;
  scored_by: string | null;
  scorer_name: string;
  scorer_image_url: string | null;
  side: "a" | "b";
  friendly_fire: boolean;
  elapsed_at: number;
  created_at: string;
}

export interface GameResponse {
  id: string;
  group_id: string | null;
  tournament_match_id: string | null;
  state: "setup" | "active" | "paused" | "completed" | "cancelled";
  score_a: number;
  score_b: number;
  elapsed: number;
  winner: "a" | "b" | null;
  goal_count: number;
  goals_to_win: number;
  win_by: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  players: GamePlayer[];
  goals: GameGoal[];
}

export interface GameSummary {
  id: string;
  state: string;
  score_a: number;
  score_b: number;
  elapsed: number;
  winner: string | null;
  created_at: string;
}

export async function createGame(
  groupId: string,
  sideA: string[],
  sideB: string[],
) {
  return request<GameResponse>(`/groups/${groupId}/games`, {
    method: "POST",
    body: JSON.stringify({ side_a: sideA, side_b: sideB }),
  });
}

export async function getActiveGame(groupId: string) {
  return request<GameResponse | null>(`/groups/${groupId}/games/active`);
}

export async function getGame(groupId: string, gameId: string) {
  return request<GameResponse>(`/groups/${groupId}/games/${gameId}`);
}

export async function updateGame(
  groupId: string,
  gameId: string,
  data: { state?: string },
) {
  return request<GameResponse>(`/groups/${groupId}/games/${gameId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function listGames(groupId: string) {
  return request<GameSummary[]>(`/groups/${groupId}/games`);
}

export async function listPlayerGames(groupId: string, playerId: string) {
  return request<GameResponse[]>(`/groups/${groupId}/games/player/${playerId}`);
}

export async function recordGoal(
  groupId: string,
  gameId: string,
  data: {
    scored_by: string | null;
    scorer_name?: string | null;
    side: string;
    friendly_fire: boolean;
    elapsed_at: number;
  },
) {
  return request<GameResponse>(`/groups/${groupId}/games/${gameId}/goals`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteGoal(
  groupId: string,
  gameId: string,
  goalId: string,
) {
  return request<GameResponse>(
    `/groups/${groupId}/games/${gameId}/goals/${goalId}`,
    { method: "DELETE" },
  );
}

/* ── Standalone games (tournament context, no group) ── */
export async function getGameById(gameId: string) {
  return request<GameResponse>(`/games/${gameId}`);
}

export async function updateGameById(
  gameId: string,
  data: { state?: string },
) {
  return request<GameResponse>(`/games/${gameId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function recordGoalOnGame(
  gameId: string,
  data: {
    scored_by: string | null;
    scorer_name?: string | null;
    side: string;
    friendly_fire: boolean;
    elapsed_at: number;
  },
) {
  return request<GameResponse>(`/games/${gameId}/goals`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteGoalOnGame(gameId: string, goalId: string) {
  return request<GameResponse>(`/games/${gameId}/goals/${goalId}`, { method: "DELETE" });
}

/* ── AI Image ── */
export async function uploadProfileImage(file: File): Promise<{ image_url: string }> {
  const form = new FormData();
  form.append("image", file);

  const token = localStorage.getItem("token");
  const res = await fetch(`${API_BASE}/images/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? res.statusText);
  }
  return res.json();
}

export async function generateAIImage(file: File): Promise<{ blob: Blob; imageId: string }> {
  const form = new FormData();
  form.append("image", file);

  const token = localStorage.getItem("token");
  const res = await fetch(`${API_BASE}/images/generate`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? res.statusText);
  }
  const imageId = res.headers.get("X-Image-Id") ?? "";
  const blob = await res.blob();
  return { blob, imageId };
}

/* ── AI Ask ── */
export type AIComponent =
  | { type: "ranked-list"; icon: string; title: string; items: { label: string; value: string; image_urls?: string[] }[] }
  | { type: "stat-highlight"; icon: string; label: string; value: string; subtitle?: string; image_urls?: string[] }
  | { type: "comparison"; title: string; sides: { name: string; image_urls?: string[]; stats: { label: string; value: string }[] }[] }
  | { type: "bar-chart"; title: string; bars: { label: string; value: number; image_urls?: string[] }[] }
  | { type: "table"; title: string; columns: string[]; rows: Record<string, string>[] }
  | { type: "callout"; emoji: string; text: string }
  | { type: "head-to-head"; player_a: { name: string; image_urls?: string[] }; player_b: { name: string; image_urls?: string[] }; stats: { label: string; a: string; b: string }[] };

export interface AskResponse {
  answer: string;
  components: AIComponent[];
  remaining: number;
}

export async function askQuestion(groupId: string, question: string) {
  return request<AskResponse>(`/groups/${groupId}/ask`, {
    method: "POST",
    body: JSON.stringify({ question }),
  });
}

/* ── Tournaments ── */
export interface TournamentTeamPlayer {
  id: string;
  team_id: string;
  name: string;
  user_id: string | null;
  user_image_url: string | null;
}

export interface TournamentTeam {
  id: string;
  tournament_id: string;
  name: string;
  user_id: string | null;
  user_name: string | null;
  user_image_url: string | null;
  image_url: string | null;
  seed: number;
  created_at: string;
  players: TournamentTeamPlayer[];
}

export interface TournamentMatch {
  id: string;
  tournament_id: string;
  round: number;
  position: number;
  team_a: TournamentTeam | null;
  team_b: TournamentTeam | null;
  score_a: number | null;
  score_b: number | null;
  winner_id: string | null;
  status: "pending" | "active" | "completed";
  is_bye: boolean;
  game_id: string | null;
  goals_to_win: number | null;
  win_by: number | null;
}

export interface TournamentDetail {
  id: string;
  name: string;
  slug: string;
  admin_user_id: string;
  admin_name: string;
  status: "registration" | "active" | "completed";
  games_per_match: number;
  goals_per_game: number;
  num_rounds: number | null;
  created_at: string;
  updated_at: string;
  teams: TournamentTeam[];
  matches: TournamentMatch[];
}

export interface TournamentSummary {
  id: string;
  name: string;
  slug: string;
  admin_user_id: string;
  status: "registration" | "active" | "completed";
  team_count: number;
  created_at: string;
}

export async function createTournament(data: {
  name: string;
  games_per_match?: number;
  goals_per_game?: number;
}) {
  return request<TournamentDetail>("/tournaments", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function startMatchGame(slug: string, matchId: string): Promise<{ game_id: string }> {
  return request<{ game_id: string }>(
    `/tournaments/${slug}/matches/${matchId}/game`,
    { method: "POST" },
  );
}

export async function listMyTournaments() {
  return request<TournamentSummary[]>("/tournaments");
}

export async function getTournament(slug: string) {
  return request<TournamentDetail>(`/tournaments/${slug}`);
}

export async function registerTeam(slug: string, name: string, userId?: string | null) {
  return request<TournamentTeam>(`/tournaments/${slug}/teams`, {
    method: "POST",
    body: JSON.stringify({ name, user_id: userId ?? null }),
  });
}

export async function removeTeam(slug: string, teamId: string) {
  return request<void>(`/tournaments/${slug}/teams/${teamId}`, { method: "DELETE" });
}

export async function startTournament(slug: string) {
  return request<TournamentDetail>(`/tournaments/${slug}/start`, { method: "POST" });
}

export async function addTeamPlayer(slug: string, teamId: string, name: string, userId?: string | null) {
  return request<TournamentTeamPlayer>(`/tournaments/${slug}/teams/${teamId}/players`, {
    method: "POST",
    body: JSON.stringify({ name, user_id: userId ?? null }),
  });
}

export async function removeTeamPlayer(slug: string, teamId: string, playerId: string) {
  return request<void>(`/tournaments/${slug}/teams/${teamId}/players/${playerId}`, { method: "DELETE" });
}

export async function updateRoundSettings(slug: string, round: number, data: { goals_to_win?: number; win_by?: number }) {
  return request<TournamentDetail>(`/tournaments/${slug}/rounds/${round}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function uploadTeamImage(slug: string, teamId: string, file: File): Promise<TournamentTeam> {
  const token = localStorage.getItem("token");
  const form = new FormData();
  form.append("image", file);
  const res = await fetch(`${API_BASE}/tournaments/${slug}/teams/${teamId}/image`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? res.statusText);
  }
  return res.json();
}

/** Generate an AI team image from an uploaded file (streaming, same UX as profile pics). */
export async function generateTeamAIImage(slug: string, teamId: string, file: File): Promise<{ blob: Blob; imageId: string }> {
  const token = localStorage.getItem("token");
  const form = new FormData();
  form.append("image", file);
  const res = await fetch(`${API_BASE}/tournaments/${slug}/teams/${teamId}/generate-image-upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? res.statusText);
  }
  const imageId = res.headers.get("X-Image-Id") ?? "";
  const blob = await res.blob();
  return { blob, imageId };
}

/** Generate an AI team image from player profile pics (streaming). */
export async function generateTeamImage(slug: string, teamId: string): Promise<{ blob: Blob; imageId: string }> {
  const token = localStorage.getItem("token");
  const res = await fetch(`${API_BASE}/tournaments/${slug}/teams/${teamId}/generate-image`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? res.statusText);
  }
  const imageId = res.headers.get("X-Image-Id") ?? "";
  const blob = await res.blob();
  return { blob, imageId };
}

/** Save a previously generated AI image as the team's image. */
export async function saveTeamImageUrl(slug: string, teamId: string, imageId: string): Promise<TournamentTeam> {
  return request<TournamentTeam>(`/tournaments/${slug}/teams/${teamId}/image-url?image_id=${encodeURIComponent(imageId)}`, {
    method: "PATCH",
  });
}
