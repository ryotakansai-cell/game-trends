// 「今日これまで」（日本時間の今日の0時から今まで）の最高同接ランキング。
//
// ページのたびに今日の毎時の記録（夜には10万行ほど）を読み直すと、1時間に1回の作り置きでも
// 1か月で最大7,000万行になる。そこで毎時の収集が配信を記録するときに、その場で today_peaks に
// 「アカウントごとの今日の最高同接」を反映させておき、ページはその上位を読むだけにする（数百行）。
// 前より同接が多いときだけ書き換えるので、書き込みも少ない（同じ人の2回目以降は、伸びたときだけ）。
// 日本の配信への絞り込みは、表に入れるときではなく読むときにやる（日付のまとめと同じ JAPAN_FILTER を使うため）
import { unstable_cache } from "next/cache";
import { batchInChunks, getDbClient } from "@/lib/db";
import { JAPAN_FILTER } from "@/lib/daily";
import { jstDay } from "@/lib/snapshot-range";
import { toPlatformId, type PlatformId } from "@/lib/platforms";

/** 毎時の収集が記録した1配信 */
export type PeakInput = {
  platformId: string;
  viewers: number;
  title: string | null;
  contentId?: string | null;
  gameId?: string | null;
};

/** 毎時の収集から呼ぶ。記録した配信を today_peaks に反映させる。
 *  その日の初めての記録なら行を作り、2回目以降は前より同接が多いときだけ書き換える（末尾の WHERE）。
 *  live_snapshots と同じく、アカウントの内部ID はDB側で引く（accounts は先に更新済み） */
export async function recordTodayPeaks(
  platform: PlatformId,
  rows: PeakInput[],
  capturedAt: string,
) {
  const day = jstDay(new Date(capturedAt));
  await batchInChunks(
    getDbClient(),
    rows
      .filter((r) => r.viewers > 0)
      .map((r) => ({
        sql: `
          INSERT INTO today_peaks
            (day, account_id, peak_viewers, peak_title, peak_content_id, peak_game_id, peak_at)
          VALUES (?, (SELECT id FROM accounts WHERE platform = ? AND platform_id = ?), ?, ?, ?, ?, ?)
          ON CONFLICT(day, account_id) DO UPDATE SET
            peak_viewers = excluded.peak_viewers,
            peak_title = excluded.peak_title,
            peak_content_id = excluded.peak_content_id,
            peak_game_id = excluded.peak_game_id,
            peak_at = excluded.peak_at
          WHERE excluded.peak_viewers > today_peaks.peak_viewers
        `,
        args: [
          day,
          platform,
          r.platformId,
          r.viewers,
          r.title,
          r.contentId ?? null,
          r.gameId ?? null,
          capturedAt,
        ],
      })),
  );
}

/** 毎朝の集計（cron/daily）から呼ぶ。2日より前の行を消す（その日の分は日付のまとめに引き継がれている） */
export async function deleteOldTodayPeaks() {
  const r = await getDbClient().execute({
    sql: "DELETE FROM today_peaks WHERE day < ?",
    args: [jstDay(new Date(Date.now() - 2 * 24 * 3600 * 1000))],
  });
  return r.rowsAffected;
}

export type TodayEntry = {
  platform: PlatformId;
  platformId: string;
  login: string | null;
  displayName: string;
  creatorId: number | null;
  peakViewers: number;
  peakTitle: string | null;
  peakContentId: string | null;
  peakGameId: string | null;
  peakAt: string;
};

async function queryToday(day: string, limit: number) {
  const db = getDbClient();
  // (day, peak_viewers) の索引を同接の多い順にたどり、日本の配信者だけを limit 件集めたら止まる。
  // 全世界の上位（日本ではない大きな配信）を飛ばす分だけ、limit より多く読む（数百行）。
  // CROSS JOIN は「today_peaks から読め」という指示（accounts から読み始めないように。lib/rising.ts と同じ）
  const [rows, count] = await Promise.all([
    db.execute({
      sql: `SELECT a.platform, a.platform_id, a.login, a.display_name, a.creator_id,
                   t.peak_viewers, t.peak_title, t.peak_content_id, t.peak_game_id, t.peak_at
            FROM today_peaks t INDEXED BY idx_today_peaks_rank
            CROSS JOIN accounts a ON a.id = t.account_id
            WHERE t.day = ? AND ${JAPAN_FILTER}
            ORDER BY t.peak_viewers DESC
            LIMIT ?`,
      args: [day, limit],
    }),
    // 最後に反映した時刻（ページに「◯分前」を出す）＝ 直近の毎時の収集の時刻。
    // today_peaks.peak_at には索引が無く、MAX を取るとその日の行（約1万行）を全部読むので、
    // 毎時の記録の captured_at の索引の端を1行だけ読む
    db.execute(
      `SELECT captured_at AS at FROM live_snapshots INDEXED BY idx_live_snapshots_time
       ORDER BY captured_at DESC LIMIT 1`,
    ),
  ]);
  return {
    day,
    updatedAt: count.rows[0]?.at ? String(count.rows[0].at) : null,
    entries: rows.rows.map((r): TodayEntry => ({
      platform: toPlatformId(r.platform),
      platformId: String(r.platform_id),
      login: r.login ? String(r.login) : null,
      displayName: String(r.display_name),
      creatorId: r.creator_id === null ? null : Number(r.creator_id),
      peakViewers: Number(r.peak_viewers),
      peakTitle: r.peak_title ? String(r.peak_title) : null,
      peakContentId: r.peak_content_id ? String(r.peak_content_id) : null,
      peakGameId: r.peak_game_id ? String(r.peak_game_id) : null,
      peakAt: String(r.peak_at),
    })),
  };
}

// 中身は毎時の収集（13・23・38・48分）でしか変わらないので、15分作り置きする。
// 読むのは数百行なので、作り直しが増えても読み取りはほとんど増えない
const cachedToday = unstable_cache(
  (day: string, limit: number) => queryToday(day, limit),
  ["today-ranking"],
  { revalidate: 900 },
);

/** 今日（日本時間）これまでの、日本の配信者の最高同接の上位 */
export function getTodayRanking(limit = 30) {
  return cachedToday(jstDay(), limit);
}
