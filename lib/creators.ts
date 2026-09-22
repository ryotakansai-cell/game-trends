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
