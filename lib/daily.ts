import { unstable_cache } from "next/cache";
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

/** まとめがある最初の日と最後の日。
 *  MIN と MAX を1つの SELECT に並べると、SQLite の「索引の端を見るだけ」の最適化が効かず
 *  全行（13万行）を読んでいた（2026-10-15 の実測）。1つずつ別の SELECT にすると、
 *  day の索引の両端の2行を読むだけで済む */
export async function getDayRange() {
  const db = getDbClient();
  const r = await db.execute(
    `SELECT (SELECT MIN(day) FROM daily_stats) AS first,
            (SELECT MAX(day) FROM daily_stats) AS last`,
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
async function queryDailySummary(day: string): Promise<DailySummary> {
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

// まとめは1回で約34万行を読む（ゲームの欄は毎時の記録の1日分）。
// 作り置き（unstable_cache）は保存場所の名前にビルドの番号が入っていて、デプロイのたびに全部消える。
// 日付ページは検索エンジンに巡回されるので、デプロイのたびに全部の日を作り直していた
// （2026-10-16 の Top Queries で、11時間に16日分・約270万行）。
//
// そこで「内容がもう変わらない日」のまとめは DB の daily_summaries に1回だけ保存し、ページは1行読むだけにする。
// 集計は翌朝にもう一度まとめ直す（lib/daily-stats.ts の rollupPendingDays）ので、直近2日は変わりうる。
// それより前の日を「終わった日」とみなす。保存は毎朝の集計（cron/daily）がやり、ページからは書かない

/** まとめの形（DailySummary）を変えたら上げる。古い形で保存した行は読まずに作り直す */
const SUMMARY_VERSION = 1;

/** 内容がもう変わらない日なら true（2日前より前） */
function isFinalDay(day: string) {
  return day < jstDay(new Date(Date.now() - 2 * 24 * 3600 * 1000));
}

async function readStoredSummary(day: string): Promise<DailySummary | null> {
  const r = await getDbClient().execute({
    sql: "SELECT data FROM daily_summaries WHERE day = ? AND version = ?",
    args: [day, SUMMARY_VERSION],
  });
  return r.rows[0]
    ? (JSON.parse(String(r.rows[0].data)) as DailySummary)
    : null;
}

// 終わった日：保存してあればそれを読む（1行）。まだ保存されていない日（毎朝少しずつ埋める）はその場で作る。
// どちらでも結果は変わらないので、作り置きは長くてよい
const cachedFinalSummary = unstable_cache(
  async (day: string) =>
    (await readStoredSummary(day)) ?? queryDailySummary(day),
  ["daily-summary-final-v2"],
  { revalidate: 30 * 86400 },
);

// 直近2日：中身が変わるのは毎朝の集計のときだけ。以前は1時間作り置きで、ボットが毎時開くと
// 1日24回作り直していた。鍵に「集計がある最新の日」を入れ、集計が進んだときだけ作り直す
const cachedRecentSummary = unstable_cache(
  (day: string, _lastDay: string) => queryDailySummary(day),
  ["daily-summary-recent-v2"],
  { revalidate: 86400 },
);

export async function getDailySummary(day: string): Promise<DailySummary> {
  if (isFinalDay(day)) return cachedFinalSummary(day);
  const lastDay = (await getDayRange())?.last ?? "";
  return cachedRecentSummary(day, lastDay);
}

/** 終わった日のまとめのうち、まだ保存していない日を新しい順に最大 limit 日ぶん作って保存する。
 *  毎朝の集計（cron/daily）から呼ぶ。ふつうは1日1日ずつ増えるだけ。
 *  初めて動かしたときや ?from= でまとめ直したときは、残りを毎朝 limit 日ずつ埋める
 *  （1日分で約34万行読むので、一度に全部はやらない）。
 *  毎時の記録は90日で消えるので、消える前に保存しておけば「見られたゲーム」も残り続ける */
export async function saveFinalSummaries(limit = 10) {
  const range = await getDayRange();
  if (!range) return [];
  const stored = await getDbClient().execute({
    sql: "SELECT day FROM daily_summaries WHERE version = ?",
    args: [SUMMARY_VERSION],
  });
  const have = new Set(stored.rows.map((r) => String(r.day)));

  const saved: string[] = [];
  for (
    let day = range.last;
    day >= range.first && saved.length < limit;
    day = shiftDay(day, -1)
  ) {
    if (!isFinalDay(day) || have.has(day)) continue;
    const summary = await queryDailySummary(day);
    await getDbClient().execute({
      sql: `INSERT OR REPLACE INTO daily_summaries (day, version, data, created_at)
            VALUES (?, ?, ?, ?)`,
      args: [
        day,
        SUMMARY_VERSION,
        JSON.stringify(summary),
        new Date().toISOString(),
      ],
    });
    saved.push(day);
  }
  return saved;
}

/** ?from= でまとめ直した日から先の保存を消す（daily_stats が変わったので作り直させる） */
export async function clearSummariesFrom(day: string) {
  const r = await getDbClient().execute({
    sql: "DELETE FROM daily_summaries WHERE day >= ?",
    args: [day],
  });
  return r.rowsAffected;
}

/** OGP 画像用。最高同接の上位 n 人と、配信者の数だけ。
 *  以前は画像のためだけに軽い SQL を別に流していた（それでも1回約6万行）。中身はまとめの
 *  「最高同接の上位20人」「配信者の数」と同じ SQL なので、作り置き済みのまとめから取り出す。
 *  過去の日はページと画像で1回の読み取りを共有でき、30日間は DB を読まない */
export async function getDailyHeadline(day: string, n = 3) {
  const summary = await getDailySummary(day);
  return { top: summary.topPeak.slice(0, n), streamers: summary.streamers };
}
