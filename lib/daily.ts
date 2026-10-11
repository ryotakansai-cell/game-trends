import { getDbClient } from "@/lib/db";
import { jstDay } from "@/lib/snapshot-range";
import { toPlatformId, type PlatformId } from "@/lib/platforms";

// 日付ごとのまとめページ（/daily/[date]）のデータ。
// 日ごとの集計（daily_stats）から作るので、まとめ終わった日（昨日まで）だけが対象。
//
// 対象は日本の配信者に絞る。daily_stats には全世界の上位800配信も入っていて、
// そのままだと英語圏の大物が上位を占め、日本の人が見たい「その日の日本の配信」にならないため：
//   - Twitch：配信の言語が日本語
//   - YouTube：日本向けの検索で見つかった監視リストのチャンネル
//   - 名寄せ済みの本人アカウント（日本の配信者を名寄せしている）
export const JAPAN_FILTER = `
  a.relation = 'self' AND (
    a.language = 'ja'
    OR a.id IN (SELECT account_id FROM youtube_watch)
    OR a.creator_id IS NOT NULL
  )`;

export type DailyEntry = {
  platform: PlatformId;
  platformId: string;
  login: string | null;
  displayName: string;
  creatorId: number | null;
  peakViewers: number;
  avgViewers: number;
  hoursLive: number;
  topGameId: string | null;
  prevPeak?: number; // 前日の最高同接（伸びた人の一覧だけ）
};

export type DailyGame = { gameId: string; avgViewers: number };

export type DailySummary = {
  day: string;
  topPeak: DailyEntry[]; // 最高同接の上位
  longest: DailyEntry[]; // 配信時間の長い順
  rising: DailyEntry[]; // 前日より最高同接が伸びた人
  personalBests: DailyEntry[]; // 直近30日の自己最高を更新した人（prevPeak = それまでの最高）
  games: DailyGame[]; // 日本の Twitch 配信で見られたゲーム
  streamers: number; // その日に配信を記録した日本の配信者の数
};

/** 2026-10-10 の形で、まとめ終わった日（記録の初日〜昨日）なら true */
export async function isAvailableDay(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const yesterday = jstDay(new Date(Date.now() - 24 * 3600 * 1000));
  if (day > yesterday) return false;
  const range = await getDayRange();
  return range !== null && day >= range.first && day <= range.last;
}

/** まとめがある最初の日と最後の日（MIN / MAX は day の索引の端を読むだけなので速い） */
export async function getDayRange() {
  const db = getDbClient();
  const r = await db.execute(
    "SELECT MIN(day) AS first, MAX(day) AS last FROM daily_stats",
  );
  const row = r.rows[0];
  if (!row?.first) return null;
  return { first: String(row.first), last: String(row.last) };
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 2026-10-10 → 10月10日（土）。日付だけの文字列を UTC として読めば、その暦日の曜日がずれない */
export function dayTitle(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEKDAYS[d.getUTCDay()]}）`;
}

/** 日付を diff 日ずらす（2026-10-10, -1 → 2026-10-09） */
export function shiftDay(day: string, diff: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

const previousDay = (day: string) => shiftDay(day, -1);

function toEntry(r: Record<string, unknown>): DailyEntry {
  return {
    platform: toPlatformId(r.platform),
    platformId: String(r.platform_id),
    login: r.login ? String(r.login) : null,
    displayName: String(r.display_name),
    creatorId: r.creator_id === null ? null : Number(r.creator_id),
    peakViewers: Number(r.peak_viewers),
    avgViewers: Number(r.avg_viewers),
    hoursLive: Number(r.hours_live),
    topGameId: r.top_game_id ? String(r.top_game_id) : null,
    prevPeak: r.prev_peak === undefined ? undefined : Number(r.prev_peak),
  };
}

const ENTRY_COLUMNS = `
  a.platform, a.platform_id, a.login, a.display_name, a.creator_id,
  d.peak_viewers, d.avg_viewers, d.hours_live, d.top_game_id`;

/** その日1日のまとめを作る。読むのは daily_stats のその日と前日（各数千行）と、
 *  ゲームの分だけ毎時の記録の1日分。ページは1日作り置きするので、読む回数は少ない */
export async function getDailySummary(day: string): Promise<DailySummary> {
  const db = getDbClient();
  const prev = previousDay(day);
  const from = new Date(`${day}T00:00:00+09:00`).toISOString();
  const to = new Date(
    new Date(`${day}T00:00:00+09:00`).getTime() + 24 * 3600 * 1000,
  ).toISOString();

  const [topPeak, longest, rising, games, count, bests] = await Promise.all([
    db.execute({
      sql: `SELECT ${ENTRY_COLUMNS}
            FROM daily_stats d JOIN accounts a ON a.id = d.account_id
            WHERE d.day = ? AND ${JAPAN_FILTER}
            ORDER BY d.peak_viewers DESC LIMIT 20`,
      args: [day],
    }),
    db.execute({
      sql: `SELECT ${ENTRY_COLUMNS}
            FROM daily_stats d JOIN accounts a ON a.id = d.account_id
            WHERE d.day = ? AND ${JAPAN_FILTER}
            ORDER BY d.hours_live DESC, d.peak_viewers DESC LIMIT 10`,
      args: [day],
    }),
    // 前日も配信していて、最高同接が伸びた人。小さな配信の「10人→40人」で埋まらないよう、
    // その日の最高同接が300人以上の人に絞る
    db.execute({
      sql: `SELECT ${ENTRY_COLUMNS}, p.peak_viewers AS prev_peak
            FROM daily_stats d
            JOIN daily_stats p ON p.account_id = d.account_id AND p.day = ?
            JOIN accounts a ON a.id = d.account_id
            WHERE d.day = ? AND d.peak_viewers >= 300 AND p.peak_viewers > 0
              AND d.peak_viewers > p.peak_viewers AND ${JAPAN_FILTER}
            ORDER BY CAST(d.peak_viewers AS REAL) / p.peak_viewers DESC
            LIMIT 10`,
      args: [prev, day],
    }),
    // 日本語の Twitch 配信で、そのゲームを見ていた人数の1日平均（毎時の記録の合計 ÷ 記録の回数）。
    // 毎時の記録は90日で消えるので、それより古い日は空になる（そのときは欄ごと出さない）
    db.execute({
      sql: `WITH jp AS (
              SELECT s.game_id, s.viewers, s.captured_at
              FROM live_snapshots s JOIN accounts a ON a.id = s.account_id
              WHERE s.captured_at >= ? AND s.captured_at < ?
                AND a.platform = 'twitch' AND a.language = 'ja' AND s.game_id IS NOT NULL
            ),
            times AS (SELECT COUNT(DISTINCT captured_at) AS n FROM jp)
            SELECT game_id, CAST(SUM(viewers) / (SELECT n FROM times) AS INTEGER) AS avg_viewers
            FROM jp GROUP BY game_id ORDER BY avg_viewers DESC LIMIT 10`,
      args: [from, to],
    }),
    db.execute({
      sql: `SELECT COUNT(*) AS n
            FROM daily_stats d JOIN accounts a ON a.id = d.account_id
            WHERE d.day = ? AND ${JAPAN_FILTER}`,
      args: [day],
    }),
    // 自己ベスト：その日の最高同接が、直近30日（前日まで）の自分の最高を上回った人。
    // 記録を取り始めたばかりの人は何をしても「自己ベスト」になるので、
    // 過去30日に5日以上の記録がある人だけにする。前日比と同じく300人以上に絞る。
    // 相関サブクエリは (account_id, day) の主キーの索引で引くので、1人あたり数十行で済む
    db.execute({
      sql: `SELECT * FROM (
              SELECT ${ENTRY_COLUMNS},
                (SELECT MAX(p.peak_viewers) FROM daily_stats p
                 WHERE p.account_id = d.account_id AND p.day >= ? AND p.day < ?) AS prev_peak,
                (SELECT COUNT(*) FROM daily_stats p
                 WHERE p.account_id = d.account_id AND p.day >= ? AND p.day < ?) AS past_days
              FROM daily_stats d JOIN accounts a ON a.id = d.account_id
              WHERE d.day = ? AND d.peak_viewers >= 300 AND ${JAPAN_FILTER}
            )
            WHERE past_days >= 5 AND peak_viewers > prev_peak
            ORDER BY peak_viewers DESC
            LIMIT 10`,
      args: [shiftDay(day, -30), day, shiftDay(day, -30), day, day],
    }),
  ]);

  return {
    day,
    topPeak: topPeak.rows.map(toEntry),
    longest: longest.rows.map(toEntry),
    rising: rising.rows.map(toEntry),
    personalBests: bests.rows.map(toEntry),
    games: games.rows.map((r) => ({
      gameId: String(r.game_id),
      avgViewers: Number(r.avg_viewers),
    })),
    streamers: Number(count.rows[0]?.n ?? 0),
  };
}

/** OGP 画像用の軽い版。最高同接の上位 n 人と、配信者の数だけ。
 *  画像は SNS に貼られるたびに作られるので、ページ用の重い集計（ゲームは毎時の記録を約5万行読む）を避ける */
export async function getDailyHeadline(day: string, n = 3) {
  const db = getDbClient();
  const [top, count] = await Promise.all([
    db.execute({
      sql: `SELECT ${ENTRY_COLUMNS}
            FROM daily_stats d JOIN accounts a ON a.id = d.account_id
            WHERE d.day = ? AND ${JAPAN_FILTER}
            ORDER BY d.peak_viewers DESC LIMIT ?`,
      args: [day, n],
    }),
    db.execute({
      sql: `SELECT COUNT(*) AS n
            FROM daily_stats d JOIN accounts a ON a.id = d.account_id
            WHERE d.day = ? AND ${JAPAN_FILTER}`,
      args: [day],
    }),
  ]);
  return {
    top: top.rows.map(toEntry),
    streamers: Number(count.rows[0]?.n ?? 0),
  };
}
