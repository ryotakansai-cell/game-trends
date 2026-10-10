// DBを読むために、lib/db.ts の接続関数を借りてくる。
// （このファイルで唯一、Twitch APIではなく自前のDBを見る処理のために使う）
import { getDbClient } from "@/lib/db";
import { pastWindow } from "@/lib/snapshot-range";
import type { PlatformAccount, PlatformContent } from "@/lib/platform";

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

// 取得したトークンを使い回すための置き場。
// これが無いと、APIを1回叩くたびにトークン取得の往復が発生する。
// IGDB(lib/igdb.ts)も同じトークンを使うので、利用者が増えるぶん効果が大きい
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken() {
  // 同じ実行環境の中では、1時間は変数のトークンをそのまま使う
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.value;
  }

  const { clientId, clientSecret } = getCredentials();

  // トークンの返事も1日作り置きする（Cloudflare では R2 に置かれ、全実行環境で共有される）。
  // Workers は実行環境が入れ替わるたびに上の変数が空になり、そのたびに別のトークンを
  // 取り直していた。fetch の作り置きは Authorization ヘッダーも見分けに使うので、
  // トークンが変わると Twitch API の作り置きも全部別物扱いになって効かなくなる。
  // アプリ用トークンの有効期限は約60日あるので、1日の作り置きなら期限切れにならない
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
    // POST は既定では作り置きされないので、force-cache で明示する
    cache: "force-cache",
    next: { revalidate: 86400 },
  });

  if (!res.ok) throw new Error(`トークン取得に失敗: ${res.status}`);

  const json = await res.json();

  cachedToken = {
    value: json.access_token as string,
    // 作り置きから返ってきた場合、expires_in は発行時点の値なので当てにならない。
    // 1時間ごとに作り置きを読み直す（R2 を読むだけなので安い）
    expiresAt: Date.now() + 3600 * 1000,
  };
  return cachedToken.value;
}

/** IGDBもTwitchと同じ認証基盤を使うので、lib/igdb.ts から借りられるように公開する */
export async function getTwitchAuth() {
  const { clientId } = getCredentials();
  const token = await getAccessToken();
  return { clientId, token };
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

/**
 * ログイン名から配信サムネイルのURLを組み立てる。
 * TwitchのCDNは live_user_{login}-{幅}x{高さ}.jpg という規則なので、
 * APIに問い合わせなくてもURLが分かる（DBに保存する必要もない）。
 */
export function twitchThumbnailFromLogin(
  login: string,
  width = 440,
  height = 248,
) {
  return `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-${width}x${height}.jpg`;
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

  // 一覧のアイコンは24〜56pxでしか出さないので、300x300（約100KB）ではなく
  // Twitchが用意している70x70（約9KB）を使う。画像最適化を切っているため、
  // ここで小さくしないと一覧1ページで数MBを読み込むことになる
  results.flat().forEach((user) =>
    map.set(user.login, {
      ...user,
      profile_image_url: user.profile_image_url.replace("300x300", "70x70"),
    }),
  );
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

/** 日本語の配信を、視聴者数の多い順に minViewers 人以上のところまで全部取得する。
 *  全世界の上位800だと日本の配信はほとんど入らず、新人も記録されないため。
 *  2026-10 の実測（日本時間22時台）で10人以上は約1,600配信、APIは約20回。
 *  Twitch API の上限は1分800回で、使った分はすぐ回復するので毎時でも余裕がある */
export async function getJapaneseStreams(minViewers = 10, maxPages = 50) {
  const streams: TwitchStreamFull[] = [];
  let cursor: string | undefined = undefined;

  for (let i = 0; i < maxPages; i++) {
    const page: { data: TwitchStreamFull[]; cursor?: string } =
      await helixPage<TwitchStreamFull>(
        "/streams?language=ja&first=100",
        cursor,
      );
    streams.push(...page.data);

    // 視聴者数の多い順に返ってくるので、下限を割ったらそれ以降は読まなくてよい
    const last = page.data.at(-1);
    if (!page.cursor || !last || last.viewer_count < minViewers) break;
    cursor = page.cursor;
  }

  return streams.filter((s) => s.viewer_count >= minViewers);
}

/** 指定したユーザーIDのうち、今配信中の人の配信を取得する（配信していない人は返らない）。
 *  名寄せ済みの配信者は、上位800配信に入っていない時間帯も記録したいので直接問い合わせる。
 *  上位800位の線は、日本の深夜で200〜570人まで下がる（2026-10 の実測） */
export async function getStreamsByUserIds(userIds: string[]) {
  if (userIds.length === 0) return [];

  // Twitch API は1回100件までなので分割する
  const chunks: string[][] = [];
  for (let i = 0; i < userIds.length; i += 100) {
    chunks.push(userIds.slice(i, i + 100));
  }

  const results = await Promise.all(
    chunks.map((chunk) => {
      const params = new URLSearchParams({ first: "100" });
      chunk.forEach((id) => params.append("user_id", id));
      return twitchFetch<TwitchStreamFull>(`/streams?${params.toString()}`);
    }),
  );
  return results.flat();
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
  title: string | null; // 配信タイトル。列を追加する前の古い行はnullになる
  current_viewers: number; // 今の視聴者数
  past_viewers: number; // 24時間前の視聴者数
  current_at: string; // 「今」の記録がいつ取られたか
  past_at: string; // 「24時間前」の記録が実際にいつ取られたか
  growth_rate: number; // 増加率（0.35 なら 35%増）
};

/** 24時間前と比べて視聴者数が伸びている配信者を取得する */
export async function getRisingStreamers(
  minViewers = 200, // 日本語の配信は10人以上も記録しているので、小さな配信の上下動で埋まらないよう絞る
  limit = 20, // 何件返すか
  language?: string, // "ja"を渡すと日本語配信だけ。省略すると全言語
): Promise<RisingStreamer[]> {
  const db = getDbClient();

  // 24時間前の前後3時間だけを読む（全履歴を読まないため。lib/snapshot-range.ts）
  const [pastFrom, pastTo] = pastWindow(3);

  const sql = `
    -- ⓪ Twitch の最新の収集時刻。captured_at の索引を新しい順にたどり、
    --    最初に見つかった Twitch の行で止まるので、全履歴を読まずに済む
    WITH latest_at AS (
      SELECT l.captured_at AS at
      FROM live_snapshots l
      JOIN accounts a ON a.id = l.account_id
      WHERE a.platform = 'twitch'
      ORDER BY l.captured_at DESC
      LIMIT 1
    ),

    -- ① 最新の収集に含まれている配信者（＝最後の観測時点で配信中）。
    --    cron は1回分を同じ captured_at で保存するので、一致で取れる
    latest AS (
      SELECT
        l.account_id,
        l.viewers AS current_viewers,
        l.title,
        l.captured_at AS current_at
      FROM live_snapshots l
      JOIN accounts a ON a.id = l.account_id
      WHERE l.captured_at = (SELECT at FROM latest_at)
        AND a.platform = 'twitch'
    ),

    -- ② 配信者ごとに「24時間前に一番近い記録」を特定する。
    --    範囲は前後3時間に絞ってある（それより遠い記録は比較に使わないため）
    past AS (
      SELECT
        l.account_id,
        l.viewers AS past_viewers,
        l.captured_at AS past_at,
        -- 「24時間前からのズレ（秒）」が小さい順に採番
        ROW_NUMBER() OVER (
          PARTITION BY l.account_id
          ORDER BY ABS(strftime('%s', l.captured_at) - strftime('%s', 'now', '-24 hours'))
        ) AS rn
      FROM live_snapshots l
      JOIN accounts a ON a.id = l.account_id
      WHERE a.platform = 'twitch'
        AND l.captured_at BETWEEN ? AND ?
    )

    -- ③ ①と②を突き合わせて、増加率を計算する
    SELECT
      -- 列名は移行前と同じにする。呼び出し側（trending/page.tsx）は変更不要
      a.platform_id AS streamer_id,
      a.login,
      a.display_name,
      l.title,
      l.current_viewers,
      p.past_viewers,
      l.current_at,
      p.past_at,
      -- CASTしないと整数同士の割り算になり0に切り捨てられる（C#のint/intと同じ）
      (CAST(l.current_viewers AS REAL) - p.past_viewers) / p.past_viewers AS growth_rate
    FROM latest l
    JOIN past p ON p.account_id = l.account_id AND p.rn = 1
    JOIN accounts a ON a.id = l.account_id
    WHERE l.current_viewers >= ?
      AND p.past_viewers > 0
      -- 増えている人だけ（急上昇ページなので、減っている人は載せない）
      AND l.current_viewers > p.past_viewers
      ${language ? "AND a.language = ?" : ""}
    ORDER BY growth_rate DESC
    LIMIT ?
  `;

  // ?の数に合わせて渡す値を変える。順番はSQL内の ? の出現順と一致させる
  const args = language
    ? [pastFrom, pastTo, minViewers, language, limit]
    : [pastFrom, pastTo, minViewers, limit];

  const result = await db.execute({ sql, args });
  return result.rows as unknown as RisingStreamer[];
}

// ============================================
// クリエイターページ用（共通の形に変換して返す）
// ============================================

/** Twitchアカウントの中身を PlatformContent に変換する */
export async function getTwitchContent(
  accounts: PlatformAccount[],
): Promise<PlatformContent[]> {
  return Promise.all(
    accounts.map(async (account) => {
      const login = account.login ?? "";

      // クリップとアーカイブの取得には user.id が要るので、先にユーザー情報を取る
      const user = await getUserByLogin(login).catch(() => null);

      // 残り3つは互いに独立しているので並列で取る
      const [stream, clips, videos] = await Promise.all([
        getStreamByLogin(login).catch(() => null),
        user ? getClipsByBroadcaster(user.id, 30, 20).catch(() => []) : [],
        user ? getVideosByUser(user.id, 12).catch(() => []) : [],
      ]);

      const displayName = user?.display_name ?? account.display_name;

      // クリップとアーカイブを、同じ ContentItem の形に揃えて1本にまとめる。
      // ページ側で混ぜて並び替えるため、種別は kindLabel で見分ける
      const items = [
        ...clips.map((c) => ({
          id: c.id,
          title: c.title,
          url: c.url,
          thumbnailUrl: c.thumbnail_url,
          platform: "twitch",
          platformLabel: "Twitch",
          relation: account.relation,
          kindLabel: "クリップ",
          channelName: displayName,
          publishedAt: c.created_at,
          viewCount: c.view_count,
          meta: `${c.view_count.toLocaleString("ja-JP")}回再生 ・ ${formatDate(c.created_at)}`,
        })),
        ...videos.map((v) => ({
          id: v.id,
          title: v.title,
          url: v.url,
          thumbnailUrl: videoThumb(v.thumbnail_url),
          platform: "twitch",
          platformLabel: "Twitch",
          relation: account.relation,
          kindLabel: "アーカイブ",
          channelName: displayName,
          publishedAt: v.created_at,
          viewCount: v.view_count,
          meta: `${v.view_count.toLocaleString("ja-JP")}回視聴 ・ ${v.duration} ・ ${formatDate(v.created_at)}`,
        })),
      ];

      return {
        accountId: account.id,
        platform: "twitch",
        label: "Twitch",
        relation: account.relation,
        // APIが取れたらそちらを優先、ダメならDBに入っている名前を使う
        displayName,
        iconUrl: user?.profile_image_url ?? null,
        profileUrl: `https://twitch.tv/${login}`,
        live: stream
          ? {
              title: stream.title,
              url: `https://twitch.tv/${login}`,
              thumbnailUrl: streamThumb(stream.thumbnail_url),
              meta: `${formatViewers(stream.viewer_count)}人が視聴中 ・ ${elapsedSince(stream.started_at)}経過`,
            }
          : null,
        items,
      };
    }),
  );
}
