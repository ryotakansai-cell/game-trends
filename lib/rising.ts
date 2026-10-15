// 急上昇（24時間前と比べて視聴者数が伸びている配信）。DB に貯めた毎時の記録から作る。
// 以前は Twitch 用と YouTube 用にほぼ同じ SQL が2つあった。違いは「24時間前の記録を探す幅」
// 「最低の視聴者数」「日本の配信の見分け方」だけなので、それを台帳（lib/platforms.ts）に移して1つにした
import { unstable_cache } from "next/cache";
import { getDbClient } from "@/lib/db";
import { captureHour, pastWindow } from "@/lib/snapshot-range";
import { PLATFORMS, type AccountRef, type PlatformId } from "@/lib/platforms";

export type RisingEntry = AccountRef & {
  displayName: string;
  contentId: string | null; // その配信の ID（YouTube は動画ID。サムネとリンクに使う）
  title: string | null; // 配信タイトル。列を足す前の古い行は null
  currentViewers: number;
  pastViewers: number;
  currentAt: string; // 「今」の記録がいつ取られたか
  growthRate: number; // 増加率（0.35 なら 35%増）
};

async function queryRising(
  platform: PlatformId,
  japan: boolean,
  limit: number,
): Promise<RisingEntry[]> {
  const db = getDbClient();
  const { windowHours, minViewers } = PLATFORMS[platform].rising;
  // 24時間前の前後◯時間だけを読む（全履歴を読まないため。lib/snapshot-range.ts）
  const [pastFrom, pastTo] = pastWindow(windowHours);

  const sql = `
    -- SQLite は表の統計（ANALYZE）を持っていないので、結合の順番を推測で決める。
    -- 普通の JOIN だと「この配信元のアカウント（Twitch は2万人以上）を1人ずつ見に行く」順を選び、
    -- 1回で15万行以上を読んでいた（2026-10-15 の実測）。CROSS JOIN は SQLite では
    -- 「左の表から読む」という指示になるので、live_snapshots の captured_at の索引から読ませる

    -- ⓪ この配信元の最新の収集時刻。captured_at の索引を新しい順にたどり、
    --    最初に見つかった行で止まるので、全履歴を読まずに済む
    WITH latest_at AS (
      SELECT l.captured_at AS at
      FROM live_snapshots l
      CROSS JOIN accounts a ON a.id = l.account_id
      WHERE a.platform = ?
      ORDER BY l.captured_at DESC
      LIMIT 1
    ),

    -- ① 最新の収集に含まれている配信者（＝最後の観測時点で配信中）。
    --    cron は1回分を同じ captured_at で保存するので、一致で取れる
    latest AS (
      SELECT
        l.account_id,
        l.content_id,
        l.title,
        l.region,
        l.viewers AS current_viewers,
        l.captured_at AS current_at,
        -- 同じ時刻に複数の配信をしている場合（YouTube）は、視聴者が多い方を採用
        ROW_NUMBER() OVER (
          PARTITION BY l.account_id
          ORDER BY l.viewers DESC
        ) AS rn
      FROM live_snapshots l
      CROSS JOIN accounts a ON a.id = l.account_id
      WHERE l.captured_at = (SELECT at FROM latest_at)
        AND a.platform = ?
    ),

    -- ①' 載せる候補（いまの視聴者が最低ライン以上の人）だけに先に絞る
    current AS (
      SELECT * FROM latest
      WHERE rn = 1 AND current_viewers >= ?
    ),

    -- ② 候補の人ごとに「24時間前に一番近い記録」を特定する（前後◯時間に絞ってある）。
    --    以前はこの配信元の全員分の記録を読んでいたが、候補の人だけを
    --    (account_id, captured_at) の索引で引けば、読むのは1人あたり数行で済む
    past AS (
      SELECT
        l.account_id,
        l.viewers AS past_viewers,
        -- 「24時間前からのズレ（秒）」が小さい順に採番
        ROW_NUMBER() OVER (
          PARTITION BY l.account_id
          ORDER BY ABS(strftime('%s', l.captured_at) - strftime('%s', 'now', '-24 hours')), l.viewers DESC
        ) AS rn
      FROM current c
      CROSS JOIN live_snapshots l ON l.account_id = c.account_id
      WHERE l.captured_at BETWEEN ? AND ?
    )

    -- ③ ①と②を突き合わせて、増加率を計算する
    SELECT
      a.platform_id,
      a.login,
      a.display_name,
      l.content_id,
      l.title,
      l.current_viewers,
      p.past_viewers,
      l.current_at,
      -- CASTしないと整数同士の割り算になり0に切り捨てられる（C#のint/intと同じ）
      (CAST(l.current_viewers AS REAL) - p.past_viewers) / p.past_viewers AS growth_rate
    FROM current l
    JOIN past p ON p.account_id = l.account_id AND p.rn = 1
    JOIN accounts a ON a.id = l.account_id
    WHERE p.past_viewers > 0
      -- 増えている人だけ（急上昇ページなので、減っている人は載せない）
      AND l.current_viewers > p.past_viewers
      ${japan ? `AND ${PLATFORMS[platform].japanLiveSql}` : ""}
    ORDER BY growth_rate DESC
    LIMIT ?
  `;

  const result = await db.execute({
    sql,
    args: [platform, platform, minViewers, pastFrom, pastTo, limit],
  });
  return result.rows.map((r) => ({
    platform,
    platformId: String(r.platform_id),
    login: r.login ? String(r.login) : null,
    displayName: String(r.display_name),
    contentId: r.content_id ? String(r.content_id) : null,
    title: r.title ? String(r.title) : null,
    currentViewers: Number(r.current_viewers),
    pastViewers: Number(r.past_viewers),
    currentAt: String(r.current_at),
    growthRate: Number(r.growth_rate),
  }));
}

// 急上昇は毎時の記録から作るので、中身は1時間に1回しか変わらない。以前は開かれるたびに
// SQL を流していた（急上昇のページは配信元4つ分を1回の表示で読む）。
// 鍵に「その配信元の収集の回」を入れ、収集が終わった頃に作り直す（lib/snapshot-range.ts の captureHour）。
// 計算の仕方を変えたら鍵の名前も変える（中の関数を直しても、同じ鍵の古い結果が残るため）
const cachedRising = unstable_cache(
  (platform: PlatformId, japan: boolean, limit: number, _hour: string) =>
    queryRising(platform, japan, limit),
  ["rising-v2"],
  { revalidate: 3600 },
);

export function getRising(
  platform: PlatformId,
  japan: boolean,
  limit = 20,
): Promise<RisingEntry[]> {
  const hour = captureHour(PLATFORMS[platform].snapshotMinute);
  return cachedRising(platform, japan, limit, hour);
}
