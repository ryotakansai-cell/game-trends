// DBを読むために、lib/db.ts の接続関数を借りてくる。
// （このファイルで唯一、Twitch APIではなく自前のDBを見る処理のために使う）
import { getDbClient } from "@/lib/db";

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
export type TwitchClip = {
  id: string;
  url: string;
  broadcaster_id: string;
  creator_name: string;
  game_id: string;
  title: string;
  view_count: number;
  created_at: string;
  thumbnail_url: string;
  duration: number;
};

export type TwitchVideo = {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  url: string;
  thumbnail_url: string;
  view_count: number;
  duration: string;
};

/** ログイン名から1人分のユーザー情報を取得 */
export async function getUserByLogin(login: string) {
  const users = await twitchFetch<TwitchUser>(
    `/users?login=${encodeURIComponent(login)}`,
  );
  return users[0] ?? null;
}

/** その人が今配信中かどうかを取得（配信していなければ null） */
export async function getStreamByLogin(login: string) {
  const streams = await twitchFetch<TwitchStreamFull>(
    `/streams?user_login=${encodeURIComponent(login)}`,
  );
  return streams[0] ?? null;
}

/** 直近N日間の人気クリップを取得 */
export async function getClipsByBroadcaster(
  broadcasterId: string,
  days = 7,
  limit = 12,
) {
  const startedAt =
    new Date(Date.now() - days * 86400000).toISOString().split(".")[0] + "Z";

  const params = new URLSearchParams({
    broadcaster_id: broadcasterId,
    first: String(limit),
    started_at: startedAt,
  });

  return twitchFetch<TwitchClip>(`/clips?${params.toString()}`);
}

/** 過去の配信アーカイブを取得 */
export async function getVideosByUser(userId: string, limit = 6) {
  const params = new URLSearchParams({
    user_id: userId,
    first: String(limit),
    type: "archive",
    sort: "time",
  });

  return twitchFetch<TwitchVideo>(`/videos?${params.toString()}`);
}

/** 動画サムネのプレースホルダを置換（%{width} 形式にも対応） */
export function videoThumb(url: string, width = 320, height = 180) {
  return url
    .replace("%{width}", String(width))
    .replace("%{height}", String(height))
    .replace("{width}", String(width))
    .replace("{height}", String(height));
}

/** ISO日時を「2026/9/6」の形に */
export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ja-JP");
}

/** 上位配信者を複数ページぶん取得する（配信者スナップショット用） */
export async function getTopStreamsPaged(pages = 8) {
  const streams: TwitchStreamFull[] = [];
  let cursor: string | undefined = undefined;

  for (let i = 0; i < pages; i++) {
    const page: { data: TwitchStreamFull[]; cursor?: string } =
      await helixPage<TwitchStreamFull>("/streams?first=100", cursor);
    streams.push(...page.data);

    if (!page.cursor) break;
    cursor = page.cursor;
  }

  return streams;
}

// ============================================
// 急上昇ランキング用（Twitch APIではなく、DBに貯めた履歴を読む）
// ============================================

// この関数が返す「1行分」の形。
// SQLの SELECT で並べた列名と、ここのプロパティ名が一致している必要がある。
export type RisingStreamer = {
  streamer_id: string;
  login: string; // URL用の名前。/streamers/faker のリンクに使う
  display_name: string; // 画面に出す表示名
  current_viewers: number; // 今の視聴者数
  past_viewers: number; // 24時間前の視聴者数
  current_at: string; // 「今」の記録がいつ取られたか
  past_at: string; // 「24時間前」の記録が実際にいつ取られたか
  growth_rate: number; // 増加率（0.35 なら 35%増）
};

/** 24時間前と比べて視聴者数が伸びている配信者を取得する */
export async function getRisingStreamers(
  minViewers = 300, // 今の視聴者数がこれ未満なら除外（小規模配信のノイズ対策）
  limit = 20, // 何件返すか
): Promise<RisingStreamer[]> {
  const db = getDbClient();

  const sql = `
    -- ① 配信者ごとに「一番新しい記録」を特定する
    WITH latest AS (
      SELECT
        streamer_id,
        viewers AS current_viewers,
        captured_at AS current_at,
        -- 配信者ごと(PARTITION BY)に、新しい順(DESC)で 1,2,3... と採番
        ROW_NUMBER() OVER (
          PARTITION BY streamer_id
          ORDER BY captured_at DESC
        ) AS rn
      FROM streamer_snapshots
    ),

    -- ② 配信者ごとに「24時間前に一番近い記録」を特定する
    past AS (
      SELECT
        streamer_id,
        viewers AS past_viewers,
        captured_at AS past_at,
        -- 「24時間前からのズレ（秒）」が小さい順に採番
        ROW_NUMBER() OVER (
          PARTITION BY streamer_id
          ORDER BY ABS(strftime('%s', captured_at) - strftime('%s', 'now', '-24 hours'))
        ) AS rn
      FROM streamer_snapshots
    )

    -- ③ ①と②を突き合わせて、増加率を計算する
    SELECT
      s.id AS streamer_id,
      s.login,
      s.display_name,
      l.current_viewers,
      p.past_viewers,
      l.current_at,
      p.past_at,
      -- CASTしないと整数同士の割り算になり0に切り捨てられる（C#のint/intと同じ）
      (CAST(l.current_viewers AS REAL) - p.past_viewers) / p.past_viewers AS growth_rate
    FROM latest l
    JOIN past p ON p.streamer_id = l.streamer_id AND p.rn = 1
    JOIN streamers s ON s.id = l.streamer_id
    WHERE l.rn = 1
      AND l.current_viewers >= ?
      AND p.past_viewers > 0
      -- 10800秒=3時間。24時間前付近のデータが無い配信者は除外
      AND ABS(strftime('%s', p.past_at) - strftime('%s', 'now', '-24 hours')) < 10800
    ORDER BY growth_rate DESC
    LIMIT ?
  `;

  const result = await db.execute({ sql, args: [minViewers, limit] });
  return result.rows as unknown as RisingStreamer[];
}
