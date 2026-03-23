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
  user_id: string;
  name: string;
  image_url: string | null;
  side: "a" | "b";
}

export interface GameGoal {
  id: string;
  scored_by: string;
  scorer_name: string;
  scorer_image_url: string | null;
  side: "a" | "b";
  friendly_fire: boolean;
  elapsed_at: number;
  created_at: string;
}

export interface GameResponse {
  id: string;
  group_id: string;
  state: "setup" | "active" | "paused" | "completed" | "cancelled";
  score_a: number;
  score_b: number;
  elapsed: number;
  winner: "a" | "b" | null;
  goal_count: number;
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
  data: {
    state?: string;
    score_a?: number;
    score_b?: number;
    elapsed?: number;
    winner?: string;
  },
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
    scored_by: string;
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

/* ── AI Image ── */
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
