import { unstable_cache } from "next/cache";
import { getDbClient } from "@/lib/db";
import { jstDay } from "@/lib/snapshot-range";
import { JAPAN_FILTER } from "@/lib/daily";
import { toPlatformId, type PlatformId } from "@/lib/platforms";

// 配信者タブ（/creators）の一覧と検索。
// 以前は名寄せ済みの98人を固定の順に並べていたが、配信者のページが数千人分に増えたので、
// 日本の配信者全体から「今」「直近7日」で並べ、名前で探せるようにした。

export type ListSort = "live" | "week" | "hours";

export type ListEntry = {
  key: string; // 名寄せ済みなら creator 単位、それ以外はアカウント単位
  platform: PlatformId; // 代表のアカウント（アイコンとリンクに使う）
  platformId: string;
  login: string | null;
  displayName: string;
  creatorId: number | null;
  platforms: PlatformId[]; // 名寄せ済みで複数の配信元に記録がある人は ["twitch", "youtube"]
  value: number; // 並び順の基準（視聴中の人数・最高同接・配信時間）
};

type Row = Record<string, unknown>;

function toEntries(rows: Row[], limit: number): ListEntry[] {
  // 名寄せ済みの人は Twitch と YouTube を1人にまとめる。
  // 行は value の大きい順に来るので、最初に出てきたアカウントを代表にする
  const byPerson = new Map<string, ListEntry>();
  for (const r of rows) {
    const creatorId = r.creator_id === null ? null : Number(r.creator_id);
    const key = creatorId !== null ? `c${creatorId}` : `a${r.id}`;
    const platform = toPlatformId(r.platform);
    const existing = byPerson.get(key);
    if (existing) {
      if (!existing.platforms.includes(platform))
        existing.platforms.push(platform);
      continue;
    }
    byPerson.set(key, {
      key,
      platform,
      platformId: String(r.platform_id),
      login: r.login ? String(r.login) : null,
      displayName: String(r.name),
      creatorId,
      platforms: [platform],
      value: Number(r.value),
    });
  }
  return [...byPerson.values()].slice(0, limit);
}

const COLUMNS = `a.id, a.platform, a.platform_id, a.login, a.creator_id,
  COALESCE(c.display_name, a.display_name) AS name`;

async function queryList(sort: ListSort, limit: number) {
  const db = getDbClient();

  if (sort === "live") {
    // 最後の収集で配信中だった人（Twitch・YouTube それぞれの最新の時刻）。
    // 2時間より前の記録は読まない（captured_at の索引で範囲を絞る）
    const since = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const r = await db.execute({
      sql: `WITH recent AS (
              SELECT s.account_id, s.viewers, s.captured_at, a.platform
              FROM live_snapshots s JOIN accounts a ON a.id = s.account_id
              WHERE s.captured_at >= ?
            ),
            latest AS (SELECT platform, MAX(captured_at) AS at FROM recent GROUP BY platform)
            SELECT ${COLUMNS}, MAX(r.viewers) AS value
            FROM recent r
            JOIN latest l ON l.platform = r.platform AND l.at = r.captured_at
            JOIN accounts a ON a.id = r.account_id
            LEFT JOIN creators c ON c.id = a.creator_id
            WHERE ${JAPAN_FILTER}
            GROUP BY a.id
            ORDER BY value DESC
            LIMIT ?`,
      args: [since, limit * 2],
    });
    return toEntries(r.rows, limit);
  }

  // 直近7日（昨日まで）の日ごとの集計から
  const since = jstDay(new Date(Date.now() - 7 * 24 * 3600 * 1000));
  const value = sort === "hours" ? "SUM(d.hours_live)" : "MAX(d.peak_viewers)";
  const r = await db.execute({
    sql: `SELECT ${COLUMNS}, ${value} AS value
          FROM daily_stats d
          JOIN accounts a ON a.id = d.account_id
          LEFT JOIN creators c ON c.id = a.creator_id
          WHERE d.day >= ? AND ${JAPAN_FILTER}
          GROUP BY a.id
          ORDER BY value DESC
          LIMIT ?`,
    args: [since, limit * 2],
  });
  return toEntries(r.rows, limit);
}

/** 並び順ごとの一覧。開かれるたびに7日分の集計（約5万行）を読まないよう、
 *  結果を5分作り置きする（並び順ごとに別々に保存される。引数も作り置きの見分けに使われるため） */
export const getStreamerList = unstable_cache(
  async (sort: ListSort, limit = 60) => queryList(sort, limit),
  ["streamer-list"],
  { revalidate: 300 },
);

/** 名前・ログイン名で探す。対象は日本の配信者（日付ページと同じ条件）。
 *  結果は直近7日の最高同接が大きい順（記録が無い人は後ろ） */
export async function searchStreamers(q: string, limit = 40) {
  const db = getDbClient();
  // LIKE の特別な文字（% と _）は、そのままの文字として探す
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const since = jstDay(new Date(Date.now() - 7 * 24 * 3600 * 1000));
  const r = await db.execute({
    sql: `SELECT ${COLUMNS},
            COALESCE((SELECT MAX(d.peak_viewers) FROM daily_stats d
                      WHERE d.account_id = a.id AND d.day >= ?), 0) AS value
          FROM accounts a
          LEFT JOIN creators c ON c.id = a.creator_id
          WHERE ${JAPAN_FILTER}
            AND (a.display_name LIKE ? ESCAPE '\\'
                 OR a.login LIKE ? ESCAPE '\\'
                 OR c.display_name LIKE ? ESCAPE '\\')
          ORDER BY value DESC
          LIMIT ?`,
    args: [since, pattern, pattern, pattern, limit * 2],
  });
  return toEntries(r.rows, limit);
}

/** 検索欄の候補（予測検索）に使う一覧。直近14日に配信した日本の配信者を、最高同接の大きい順に。
 *  打つたびにサーバーへ問い合わせると、1文字ごとにアカウントの表（2万行以上）を全部読むことになるので、
 *  一覧を1回だけブラウザに渡し、絞り込みはブラウザでやる（/creators/suggest。数時間作り置き） */
export async function getSuggestEntries(limit = 2000) {
  const db = getDbClient();
  const since = jstDay(new Date(Date.now() - 14 * 24 * 3600 * 1000));
  const r = await db.execute({
    sql: `SELECT ${COLUMNS}, MAX(d.peak_viewers) AS value
          FROM daily_stats d
          JOIN accounts a ON a.id = d.account_id
          LEFT JOIN creators c ON c.id = a.creator_id
          WHERE d.day >= ? AND ${JAPAN_FILTER}
          GROUP BY a.id
          ORDER BY value DESC
          LIMIT ?`,
    args: [since, limit * 2],
  });
  return toEntries(r.rows, limit);
}
