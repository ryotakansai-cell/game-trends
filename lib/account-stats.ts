import { getDbClient } from "@/lib/db";
import { jstDay } from "@/lib/snapshot-range";

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
