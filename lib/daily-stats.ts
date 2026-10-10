import { getDbClient } from "@/lib/db";
import { jstDay } from "@/lib/snapshot-range";

/** 毎時の記録（live_snapshots）を残す日数。これより古いものは日ごとの集計（daily_stats）だけ残す */
export const RAW_KEEP_DAYS = 90;

/** 日本時間のある1日が、UTC の ISO 文字列でいつからいつまでかを返す */
function jstDayRange(day: string): [string, string] {
  const start = new Date(`${day}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return [start.toISOString(), end.toISOString()];
}

/** day の翌日（2026-10-10 → 2026-10-11） */
function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** 日本時間の1日分の毎時の記録を、アカウント×日の1行にまとめて daily_stats に書く。
 *  同じ日をもう一度まとめても上書きされるだけなので、何度実行しても安全 */
async function rollupDay(day: string) {
  const db = getDbClient();
  const [from, to] = jstDayRange(day);

  const result = await db.execute({
    sql: `
      INSERT OR REPLACE INTO daily_stats
        (account_id, day, peak_viewers, avg_viewers, hours_live, top_game_id)
      WITH day_rows AS (
        -- captured_at の索引で、その日の分だけを読む
        SELECT account_id, viewers, game_id, captured_at
        FROM live_snapshots
        WHERE captured_at >= ? AND captured_at < ?
      ),
      per_account AS (
        SELECT
          account_id,
          MAX(viewers) AS peak,
          CAST(ROUND(AVG(viewers)) AS INTEGER) AS avg_v,
          -- 記録は毎時1回なので「記録があった時間の数」＝配信時間。
          -- YouTube は同じ時間に複数の配信が記録されることがあるので、時刻（時まで）で数える
          COUNT(DISTINCT substr(captured_at, 1, 13)) AS hours
        FROM day_rows
        GROUP BY account_id
      ),
      game_rank AS (
        -- 一番多く記録されたゲーム＝一番長く遊んだゲーム。同じ回数なら視聴者が多かった方
        SELECT
          account_id,
          game_id,
          ROW_NUMBER() OVER (
            PARTITION BY account_id ORDER BY COUNT(*) DESC, MAX(viewers) DESC
          ) AS rn
        FROM day_rows
        WHERE game_id IS NOT NULL
        GROUP BY account_id, game_id
      )
      SELECT p.account_id, ?, p.peak, p.avg_v, p.hours, g.game_id
      FROM per_account p
      LEFT JOIN game_rank g ON g.account_id = p.account_id AND g.rn = 1
    `,
    args: [from, to, day],
  });
  return result.rowsAffected;
}

/** まだまとめていない日を、昨日の分まで順にまとめる。
 *  cron が1日失敗しても、次の日に失敗した日の分もまとめて追いつく。
 *  昨日の分は毎回まとめ直す（日付が変わった直後に遅れて入った記録も拾うため） */
export async function rollupPendingDays() {
  const db = getDbClient();
  const yesterday = jstDay(new Date(Date.now() - 24 * 3600 * 1000));

  const last = await db.execute("SELECT MAX(day) AS day FROM daily_stats");
  let day = last.rows[0]?.day ? String(last.rows[0].day) : null;

  if (!day) {
    // 初回は、記録が始まった日から（captured_at の索引の先頭を読むだけなので速い）
    const first = await db.execute(
      "SELECT MIN(captured_at) AS at FROM live_snapshots",
    );
    if (!first.rows[0]?.at) return [];
    day = jstDay(new Date(String(first.rows[0].at)));
  }

  const done: { day: string; accounts: number }[] = [];
  for (; day <= yesterday; day = nextDay(day)) {
    done.push({ day, accounts: await rollupDay(day) });
  }
  return done;
}

/** 古い記録を消す。必ず rollupPendingDays の後に呼ぶ（まとめる前に消すと統計が消える） */
export async function deleteOldRecords() {
  const db = getDbClient();

  // 90日より前の日本時間の0時。その日の分は集計済み（昨日までまとめ終わっている）
  const cutoffDay = jstDay(
    new Date(Date.now() - RAW_KEEP_DAYS * 24 * 3600 * 1000),
  );
  const [cutoff] = jstDayRange(cutoffDay);

  // 念のため、消す範囲がすべて集計済みかを確かめてから消す
  const last = await db.execute("SELECT MAX(day) AS day FROM daily_stats");
  const lastDay = last.rows[0]?.day ? String(last.rows[0].day) : "";
  if (lastDay < cutoffDay) {
    throw new Error(
      `集計が ${lastDay || "未実行"} までしか無いので、${cutoffDay} より前の記録は消さない`,
    );
  }

  const snapshots = await db.execute({
    sql: "DELETE FROM live_snapshots WHERE captured_at < ?",
    args: [cutoff],
  });

  // RSS の動画は直近7日の分しか確かめないので、10日より前に確かめた記録は使わない
  const checks = await db.execute({
    sql: "DELETE FROM youtube_video_checks WHERE checked_at < ?",
    args: [new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString()],
  });

  return {
    deleted_snapshots: snapshots.rowsAffected,
    deleted_video_checks: checks.rowsAffected,
  };
}
