import { getDbClient } from "@/lib/db";
import type { PlatformAccount, PlatformContent } from "@/lib/platform";
import { getTwitchContent } from "@/lib/twitch";
import { getYouTubeContent } from "@/lib/youtube";

export type Creator = {
  id: number;
  display_name: string;
};

/** 人物1人を取得する。存在しなければ null */
export async function getCreator(id: number): Promise<Creator | null> {
  const db = getDbClient();
  const result = await db.execute({
    sql: `SELECT id, display_name FROM creators WHERE id = ?`,
    args: [id],
  });
  // 0件なら rows[0] は undefined なので ?? で null に寄せる
  return (result.rows[0] as unknown as Creator) ?? null;
}

/** その人物に紐付く全アカウントを取得する。
 *  本人 → 切り抜き → アーカイブ の順に並べたいので CASE で並び替える */
export async function getCreatorAccounts(
  creatorId: number,
): Promise<PlatformAccount[]> {
  const db = getDbClient();
  const result = await db.execute({
    sql: `
      SELECT id, platform, platform_id, login, display_name, relation
      FROM accounts
      WHERE creator_id = ?
      ORDER BY
        CASE relation WHEN 'self' THEN 0 WHEN 'clip' THEN 1 ELSE 2 END,
        platform,
        id
    `,
    args: [creatorId],
  });
  return result.rows as unknown as PlatformAccount[];
}

/** 全アカウントの中身を取りに行く「振り分け役」。
 *  ツイキャスを足すときは、ここに2行足して
 *  lib/twitcasting.ts に getTwitCastingContent を書けばよい。 */
export async function getCreatorContents(
  accounts: PlatformAccount[],
): Promise<PlatformContent[]> {
  const twitch = accounts.filter((a) => a.platform === "twitch");
  const youtube = accounts.filter((a) => a.platform === "youtube");

  // プラットフォーム同士は独立しているので同時に取りに行く。
  // 片方のAPIが落ちてももう片方は表示したいので、それぞれ catch する
  const [twitchContents, youtubeContents] = await Promise.all([
    getTwitchContent(twitch).catch(() => []),
    getYouTubeContent(youtube).catch(() => []),
  ]);

  // 上の並列取得で順番が崩れるので、accounts の並び（本人が先）に戻す
  const byAccountId = new Map<number, PlatformContent>();
  for (const c of [...twitchContents, ...youtubeContents]) {
    byAccountId.set(c.accountId, c);
  }
  return (
    accounts
      .map((a) => byAccountId.get(a.id))
      // 取得に失敗した（undefinedの）ものを除く。
      // 「c is PlatformContent」はTypeScriptに
      // 「ここを通った後は undefined ではない」と伝える書き方
      .filter((c): c is PlatformContent => c !== undefined)
  );
}

export type CreatorSummary = {
  id: number;
  displayName: string;
  accountCount: number;
  platforms: string[];
  twitchLogin: string | null; // アイコン取得用
};

/** 一覧ページ用。人物と、その集計をまとめて1回で取る */
export async function getCreators(limit = 100): Promise<CreatorSummary[]> {
  const db = getDbClient();
  const result = await db.execute({
    sql: `
      SELECT
        c.id,
        c.display_name,
        COUNT(a.id) AS account_count,
        -- 持っているプラットフォームを "twitch,youtube" という1つの文字列にまとめる
        GROUP_CONCAT(DISTINCT a.platform) AS platforms,
        -- アイコン取得に使う「Twitch本人アカウントのログイン名」を1つだけ拾う。
        -- MAX(CASE ...) は「グループの中から条件に合う値を1つ取り出す」定番の書き方。
        -- 条件に合わない行は NULL になり、MAX は NULL を無視するので残った1件が取れる
        MAX(CASE WHEN a.platform = 'twitch' AND a.relation = 'self'
                 THEN a.login END) AS twitch_login
      FROM creators c
      JOIN accounts a ON a.creator_id = c.id
      GROUP BY c.id
      ORDER BY account_count DESC, c.id
      LIMIT ?
    `,
    args: [limit],
  });

  return result.rows.map((r) => ({
    id: Number(r.id),
    displayName: String(r.display_name),
    accountCount: Number(r.account_count),
    // "twitch,youtube" を配列に戻す。空文字のときに [""] にならないよう filter する
    platforms: String(r.platforms ?? "")
      .split(",")
      .filter(Boolean),
    twitchLogin: r.twitch_login ? String(r.twitch_login) : null,
  }));
}

/** ランキングのアイコンの飛び先を決めるための対応表。
 *  "twitch:123456" や "youtube:UCxxxx" を鍵に creator_id を引ける Map を返す。
 *  名寄せしていない配信者は入らないので、呼び出し側で従来のリンクに切り替える */
export async function getCreatorIdMap(
  keys: { platform: string; platformId: string }[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (keys.length === 0) return map;

  const db = getDbClient();
  // 同じIDが重複して届くことがあるので Set で一意にする
  const ids = [...new Set(keys.map((k) => k.platformId))];
  const placeholders = ids.map(() => "?").join(",");

  const result = await db.execute({
    sql: `
      SELECT platform, platform_id, creator_id
      FROM accounts
      WHERE creator_id IS NOT NULL
        AND platform_id IN (${placeholders})
    `,
    args: ids,
  });

  for (const r of result.rows) {
    map.set(`${r.platform}:${r.platform_id}`, Number(r.creator_id));
  }
  return map;
}
