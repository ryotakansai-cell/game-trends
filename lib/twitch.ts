const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const HELIX = "https://api.twitch.tv/helix";

export type TwitchGame = {
  id: string;
  name: string;
  box_art_url: string;
  igdb_id: string;
};

function getCredentials() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET が未設定です");
  }
  return { clientId, clientSecret };
}

async function getAccessToken() {
  const { clientId, clientSecret } = getCredentials();

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`トークン取得に失敗: ${res.status}`);

  const json = await res.json();
  return json.access_token as string;
}

async function twitchFetch<T>(path: string, revalidate = 300): Promise<T[]> {
  const { clientId } = getCredentials();
  const token = await getAccessToken();

  const res = await fetch(`${HELIX}${path}`, {
    headers: {
      "Client-Id": clientId,
      Authorization: `Bearer ${token}`,
    },
    next: { revalidate },
  });

  if (!res.ok) {
    throw new Error(`Twitch APIエラー ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  return json.data as T[];
}

export async function getTopGames(limit = 30) {
  return twitchFetch<TwitchGame>(`/games/top?first=${limit}`);
}

export function boxArt(url: string, width = 285, height = 380) {
  return url
    .replace("{width}", String(width))
    .replace("{height}", String(height));
}

export function isRealGame(game: TwitchGame) {
  return game.igdb_id !== "";
}

export type TwitchStream = {
  id: string;
  user_name: string;
  game_id: string;
  title: string;
  viewer_count: number;
  language: string;
};

async function helixPage<T>(
  path: string,
  cursor?: string,
): Promise<{ data: T[]; cursor?: string }> {
  const { clientId } = getCredentials();
  const token = await getAccessToken();

  const url = new URL(`${HELIX}${path}`);
  if (cursor) url.searchParams.set("after", cursor);

  const res = await fetch(url, {
    headers: {
      "Client-Id": clientId,
      Authorization: `Bearer ${token}`,
    },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    throw new Error(`Twitch APIエラー ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  return { data: json.data as T[], cursor: json.pagination?.cursor };
}

export async function getViewerCountByGame(pages = 5) {
  const counts = new Map<string, number>();
  let cursor: string | undefined = undefined;

  for (let i = 0; i < pages; i++) {
    const page: { data: TwitchStream[]; cursor?: string } =
      await helixPage<TwitchStream>("/streams?first=100", cursor);

    for (const stream of page.data) {
      const current = counts.get(stream.game_id) ?? 0;
      counts.set(stream.game_id, current + stream.viewer_count);
    }

    if (!page.cursor) break;
    cursor = page.cursor;
  }

  return counts;
}

export function formatViewers(n: number) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return n.toLocaleString("ja-JP");
}

// ============================================
// 配信者ランキング用
// ============================================

export type TwitchStreamFull = {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  game_id: string;
  game_name: string;
  type: string;
  title: string;
  viewer_count: number;
  started_at: string;
  language: string;
  thumbnail_url: string;
  tags: string[] | null;
};

/** 配信中のストリームを視聴者数順に取得する */
export async function getTopStreams(options?: {
  language?: string;
  gameId?: string;
  limit?: number;
}) {
  const params = new URLSearchParams();
  params.set("first", String(options?.limit ?? 40));
  if (options?.language) params.set("language", options.language);
  if (options?.gameId) params.set("game_id", options.gameId);

  return twitchFetch<TwitchStreamFull>(`/streams?${params.toString()}`);
}

/** サムネイルURLのプレースホルダを実サイズに置換する */
export function streamThumb(url: string, width = 440, height = 248) {
  return url
    .replace("{width}", String(width))
    .replace("{height}", String(height));
}

/** 配信開始からの経過時間を「3時間20分」の形にする */
export function elapsedSince(startedAt: string) {
  const diffMs = Date.now() - new Date(startedAt).getTime();
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(minutes / 60);

  if (hours === 0) return `${minutes}分`;
  return `${hours}時間${minutes % 60}分`;
}
/** 特定のゲーム1件を取得する */
export async function getGameById(gameId: string) {
  const games = await twitchFetch<TwitchGame>(`/games?id=${gameId}`);
  return games[0] ?? null;
}
export type TwitchUser = {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
  description: string;
};

/** ログイン名の配列からユーザー情報をまとめて取得する */
export async function getUsersByLogin(logins: string[]) {
  const map = new Map<string, TwitchUser>();
  if (logins.length === 0) return map;

  // Twitch APIは1回100件までなので分割する
  const chunks: string[][] = [];
  for (let i = 0; i < logins.length; i += 100) {
    chunks.push(logins.slice(i, i + 100));
  }

  const results = await Promise.all(
    chunks.map((chunk) => {
      const params = new URLSearchParams();
      chunk.forEach((login) => params.append("login", login));
      return twitchFetch<TwitchUser>(`/users?${params.toString()}`);
    }),
  );

  results.flat().forEach((user) => map.set(user.login, user));
  return map;
}
