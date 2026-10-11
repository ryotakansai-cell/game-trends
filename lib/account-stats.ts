import { getDbClient } from "@/lib/db";
import { jstDay } from "@/lib/snapshot-range";
import { JAPAN_FILTER } from "@/lib/daily";

/** グラフの1日分。配信しなかった日は peak = 0 */
export type DayPoint = {
  day: string; // 日本時間の日付（2026-10-10）
  peak: number;
  hours: number;
};

export type AccountStats = {
  days: DayPoint[]; // 古い順。配信しなかった日も含めて期間の日数ぶん並ぶ
  avgViewers: number; // 配信していた時間の平均同接
  peakViewers: number;
  peakDay: string;
  hoursLive: number;
  liveDays: number;
  topGames: { gameId: string; hours: number }[]; // Twitch のみ（YouTube はゲームの情報が無い）
};

/** プラットフォームのIDから、DBの内部ID（accounts.id）を引く。記録が無ければ null */
export async function getAccountId(
  platform: string,
  platformId: string,
): Promise<number | null> {
  const db = getDbClient();
  const r = await db.execute({
    sql: "SELECT id FROM accounts WHERE platform = ? AND platform_id = ?",
    args: [platform, platformId],
  });
  return r.rows[0] ? Number(r.rows[0].id) : null;
}

export type AccountInfo = {
  id: number;
  platform: string;
  platformId: string;
  login: string | null;
  displayName: string;
  creatorId: number | null;
};

/** プラットフォームのIDからアカウントの情報を引く。DB に記録が無ければ null */
export async function getAccountInfo(
  platform: string,
  platformId: string,
): Promise<AccountInfo | null> {
  const db = getDbClient();
  const r = await db.execute({
    sql: `SELECT id, login, display_name, creator_id
          FROM accounts WHERE platform = ? AND platform_id = ?`,
    args: [platform, platformId],
  });
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    platform,
    platformId,
    login: row.login ? String(row.login) : null,
    displayName: String(row.display_name),
    creatorId: row.creator_id === null ? null : Number(row.creator_id),
  };
}

/** sitemap に載せる配信者。直近 days 日の配信時間が長い順に、名寄せしていない人だけ。
 *  名寄せ済みの人は統合ページ（/creators/[id]）が載るので、同じ人を二重に載せない。
 *  Twitch は日本語の配信者、YouTube は日本向けの検索で見つかった監視リストのチャンネルに絞る */
export async function getTopUnlinkedAccounts(
  platform: "twitch" | "youtube",
  limit: number,
  days = 14,
): Promise<{ platformId: string; login: string | null }[]> {
  const db = getDbClient();
  const since = jstDay(new Date(Date.now() - days * 24 * 3600 * 1000));
  const filter =
    platform === "twitch"
      ? "a.language = 'ja'"
      : "a.id IN (SELECT account_id FROM youtube_watch)";
  const r = await db.execute({
    sql: `SELECT a.platform_id, a.login, SUM(d.hours_live) AS hours
          FROM daily_stats d
          JOIN accounts a ON a.id = d.account_id
          WHERE d.day >= ? AND a.platform = ? AND a.creator_id IS NULL AND ${filter}
          GROUP BY a.id
          ORDER BY hours DESC
          LIMIT ?`,
    args: [since, platform, limit],
  });
  return r.rows.map((row) => ({
    platformId: String(row.platform_id),
    login: row.login ? String(row.login) : null,
  }));
}

export type PastStream = {
  contentId: string; // YouTube の動画ID
  title: string;
  peakViewers: number;
  lastSeenAt: string; // 最後に配信中だと記録した時刻
};

/** 記録に残っている最近の配信（YouTube の動画単位）を新しい順に返す。
 *  YouTube API を使わず DB だけで出す。チャンネルのページは検索エンジンに
 *  何千ページも巡回される可能性があり、表示のたびに API を呼ぶと1日の枠を使い切るため */
export async function getRecentStreams(
  accountId: number,
  limit = 12,
): Promise<PastStream[]> {
  const db = getDbClient();
  // 毎時の記録は90日分ある。範囲で絞ってから動画ごとにまとめる
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const r = await db.execute({
    sql: `SELECT content_id, MAX(title) AS title, MAX(viewers) AS peak,
                 MAX(captured_at) AS last_at
          FROM live_snapshots
          WHERE account_id = ? AND captured_at >= ? AND content_id IS NOT NULL
          GROUP BY content_id
          ORDER BY last_at DESC
          LIMIT ?`,
    args: [accountId, since, limit],
  });
  return r.rows.map((row) => ({
    contentId: String(row.content_id),
    title: String(row.title ?? ""),
    peakViewers: Number(row.peak),
    lastSeenAt: String(row.last_at),
  }));
}

/** 直近 days 日（昨日まで）の配信の記録をまとめる。1日も配信の記録が無ければ null。
 *  今日の分は日ごとの集計がまだ無い（毎朝まとめる）ので含めない */
export async function getAccountStats(
  accountId: number,
  days = 30,
): Promise<AccountStats | null> {
  const db = getDbClient();
  const DAY = 24 * 3600 * 1000;

  // 期間の日付を古い順に並べる（配信しなかった日も0で埋めて、グラフに空白として出すため）
  const dayList: string[] = [];
  for (let i = days; i >= 1; i--) {
    dayList.push(jstDay(new Date(Date.now() - i * DAY)));
  }
  const first = dayList[0];
  const last = dayList[dayList.length - 1];

  // ゲームは毎時の記録から数える（日ごとの集計には「その日一番遊んだ1本」しか無いため）。
  // 毎時の記録は90日残すので、30日なら足りる。captured_at の範囲は日本時間の日付に合わせる
  const from = new Date(`${first}T00:00:00+09:00`).toISOString();
  const to = new Date(
    new Date(`${last}T00:00:00+09:00`).getTime() + DAY,
  ).toISOString();

  const [daily, games] = await Promise.all([
    db.execute({
      sql: `SELECT day, peak_viewers, avg_viewers, hours_live
            FROM daily_stats
            WHERE account_id = ? AND day >= ? AND day <= ?`,
      args: [accountId, first, last],
    }),
    db.execute({
      sql: `SELECT game_id, COUNT(DISTINCT substr(captured_at, 1, 13)) AS hours
            FROM live_snapshots
            WHERE account_id = ? AND captured_at >= ? AND captured_at < ?
              AND game_id IS NOT NULL
            GROUP BY game_id
            ORDER BY hours DESC
            LIMIT 3`,
      args: [accountId, from, to],
    }),
  ]);

  if (daily.rows.length === 0) return null;

  const byDay = new Map(daily.rows.map((r) => [String(r.day), r]));
  let peakViewers = 0;
  let peakDay = "";
  let hoursLive = 0;
  let viewerHours = 0; // 平均同接 × 時間 の合計（日ごとの平均を、配信時間で重み付けして平均するため）

  const points = dayList.map((day) => {
    const r = byDay.get(day);
    if (!r) return { day, peak: 0, hours: 0 };
    const peak = Number(r.peak_viewers);
    const hours = Number(r.hours_live);
    if (peak > peakViewers) {
      peakViewers = peak;
      peakDay = day;
    }
    hoursLive += hours;
    viewerHours += Number(r.avg_viewers) * hours;
    return { day, peak, hours };
  });

  return {
    days: points,
    avgViewers: hoursLive > 0 ? Math.round(viewerHours / hoursLive) : 0,
    peakViewers,
    peakDay,
    hoursLive,
    liveDays: daily.rows.length,
    topGames: games.rows.map((r) => ({
      gameId: String(r.game_id),
      hours: Number(r.hours),
    })),
  };
}

export type DayStream = {
  title: string;
  contentId: string | null; // YouTube の動画ID（Twitch は無い）
  gameId: string | null;
  peakViewers: number;
  hours: number;
  startAt: string | null; // 最初に記録した時刻（主な1本しか残っていない古い日は null）
};

/** ある日（日本時間）に配信していたものを、長かった順に返す。
 *  90日以内は毎時の記録から全部、それより前は日ごとの集計に残した主な1本だけ */
export async function getDayStreams(
  accountIds: number[],
  day: string,
): Promise<DayStream[]> {
  if (accountIds.length === 0) return [];
  const db = getDbClient();
  const start = new Date(`${day}T00:00:00+09:00`);
  const from = start.toISOString();
  const to = new Date(start.getTime() + 24 * 3600 * 1000).toISOString();
  const ids = accountIds.map(() => "?").join(",");

  const raw = await db.execute({
    sql: `SELECT MAX(title) AS title, content_id, MAX(game_id) AS game_id,
                 MAX(viewers) AS peak, COUNT(DISTINCT substr(captured_at, 1, 13)) AS hours,
                 MIN(captured_at) AS start_at
          FROM live_snapshots
          WHERE account_id IN (${ids}) AND captured_at >= ? AND captured_at < ?
            AND title IS NOT NULL
          GROUP BY COALESCE(content_id, title)
          ORDER BY hours DESC, peak DESC
          LIMIT 10`,
    args: [...accountIds, from, to],
  });
  if (raw.rows.length > 0) {
    return raw.rows.map((r) => ({
      title: String(r.title),
      contentId: r.content_id ? String(r.content_id) : null,
      gameId: r.game_id ? String(r.game_id) : null,
      peakViewers: Number(r.peak),
      hours: Number(r.hours),
      startAt: String(r.start_at),
    }));
  }

  // 毎時の記録が消えた古い日は、日ごとの集計に残した主な1本
  const kept = await db.execute({
    sql: `SELECT main_title, main_content_id, top_game_id, peak_viewers, hours_live
          FROM daily_stats
          WHERE account_id IN (${ids}) AND day = ? AND main_title IS NOT NULL
          ORDER BY hours_live DESC`,
    args: [...accountIds, day],
  });
  return kept.rows.map((r) => ({
    title: String(r.main_title),
    contentId: r.main_content_id ? String(r.main_content_id) : null,
    gameId: r.top_game_id ? String(r.top_game_id) : null,
    peakViewers: Number(r.peak_viewers),
    hours: Number(r.hours_live),
    startAt: null,
  }));
}

/** よく配信する時間帯。直近 days 日の毎時の記録を、日本時間の曜日（0=日曜）×時（0〜23）で数える。
 *  値は「その曜日のその時間に配信していた回数」（4週なら最大4〜5） */
export async function getHourHeatmap(
  accountIds: number[],
  days = 28,
): Promise<number[][]> {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  if (accountIds.length === 0) return grid;
  const db = getDbClient();
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const ids = accountIds.map(() => "?").join(",");
  // 同じ時刻に Twitch と YouTube の両方で記録されていても1回と数える
  const r = await db.execute({
    sql: `SELECT strftime('%w', captured_at, '+9 hours') AS wd,
                 strftime('%H', captured_at, '+9 hours') AS h,
                 COUNT(DISTINCT substr(captured_at, 1, 13)) AS n
          FROM live_snapshots
          WHERE account_id IN (${ids}) AND captured_at >= ?
          GROUP BY wd, h`,
    args: [...accountIds, since],
  });
  for (const row of r.rows) {
    grid[Number(row.wd)][Number(row.h)] = Number(row.n);
  }
  return grid;
}

/** 同じゲームを直近7日に配信していた日本の配信者（最高同接の大きい順）。
 *  日ごとの集計の「その日一番遊んだゲーム」で見るので、少しだけ遊んだ人は入らない */
export async function getSameGameStreamers(
  gameId: string,
  excludeAccountIds: number[],
  limit = 6,
) {
  const db = getDbClient();
  const since = jstDay(new Date(Date.now() - 7 * 24 * 3600 * 1000));
  const exclude = excludeAccountIds.length
    ? `AND a.id NOT IN (${excludeAccountIds.map(() => "?").join(",")})`
    : "";
  const r = await db.execute({
    sql: `SELECT a.id, a.platform, a.platform_id, a.login, a.creator_id,
                 COALESCE(c.display_name, a.display_name) AS name,
                 MAX(d.peak_viewers) AS peak
          FROM daily_stats d
          JOIN accounts a ON a.id = d.account_id
          LEFT JOIN creators c ON c.id = a.creator_id
          WHERE d.day >= ? AND d.top_game_id = ? ${exclude} AND ${JAPAN_FILTER}
          GROUP BY a.id
          ORDER BY peak DESC
          LIMIT ?`,
    args: [since, gameId, ...excludeAccountIds, limit],
  });
  return r.rows.map((row) => ({
    platform:
      row.platform === "youtube" ? ("youtube" as const) : ("twitch" as const),
    platformId: String(row.platform_id),
    login: row.login ? String(row.login) : null,
    creatorId: row.creator_id === null ? null : Number(row.creator_id),
    displayName: String(row.name),
    peakViewers: Number(row.peak),
  }));
}
