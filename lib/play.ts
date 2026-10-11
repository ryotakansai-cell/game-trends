// ゲームを「遊んでいる人数」の記録（Steam・Roblox など）。プラットフォームをまたいで共通。
// play_titles（マスタ）と play_snapshots（毎時の人数）の2つの表を使う。
// 配信の accounts / live_snapshots と同じ考え方で、名前や画像は毎時保存しない。
import { getDbClient, batchInChunks } from "@/lib/db";

export type PlayPlatform = "steam" | "roblox";

/** 毎時の収集で集めた1本分 */
export type PlayRow = {
  externalId: string;
  players: number | null;
  rank: number;
  peakToday?: number;
  prevRank?: number | null;
};

/** マスタに書く1本分（新しいゲームか、1日以上更新していないものだけ） */
export type TitleInfo = {
  externalId: string;
  name: string;
  imageUrl: string | null;
  twitchGameId: string | null;
};

/** マスタの更新が必要なもの（まだ無い・1日以上前に更新した）の外部IDを返す */
export async function titlesToRefresh(
  platform: PlayPlatform,
  externalIds: string[],
) {
  if (externalIds.length === 0) return [];
  const db = getDbClient();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const r = await db.execute({
    sql: `SELECT external_id FROM play_titles
          WHERE platform = ? AND updated_at >= ?
            AND external_id IN (${externalIds.map(() => "?").join(",")})`,
    args: [platform, since, ...externalIds],
  });
  const fresh = new Set(r.rows.map((row) => String(row.external_id)));
  return externalIds.filter((id) => !fresh.has(id));
}

/** マスタを書き、毎時の人数を記録する */
export async function savePlaySnapshot(
  platform: PlayPlatform,
  titles: TitleInfo[],
  rows: PlayRow[],
  capturedAt: string,
) {
  const db = getDbClient();
  await batchInChunks(
    db,
    titles.map((t) => ({
      sql: `INSERT INTO play_titles (platform, external_id, name, image_url, twitch_game_id, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(platform, external_id) DO UPDATE SET
              name = excluded.name,
              image_url = excluded.image_url,
              twitch_game_id = excluded.twitch_game_id,
              updated_at = excluded.updated_at`,
      args: [
        platform,
        t.externalId,
        t.name,
        t.imageUrl,
        t.twitchGameId,
        capturedAt,
      ],
    })),
  );
  await batchInChunks(
    db,
    rows.map((r) => ({
      sql: `INSERT INTO play_snapshots (title_id, players, rank, peak_today, prev_rank, captured_at)
            VALUES ((SELECT id FROM play_titles WHERE platform = ? AND external_id = ?), ?, ?, ?, ?, ?)`,
      args: [
        platform,
        r.externalId,
        r.players,
        r.rank,
        r.peakToday ?? null,
        r.prevRank ?? null,
        capturedAt,
      ],
    })),
  );
}

export type PlayRankingRow = {
  externalId: string;
  name: string;
  imageUrl: string | null;
  twitchGameId: string | null;
  players: number | null;
  rank: number;
  peakToday: number | null;
  prevRank: number | null;
  players24hAgo: number | null; // 24時間前に一番近い記録（前後2時間以内）。無ければ null
  capturedAt: string;
};

/** 最新の収集の順位表。24時間前の人数も添える（急上昇・前日比のため） */
export async function getPlayRanking(
  platform: PlayPlatform,
  limit = 50,
): Promise<PlayRankingRow[]> {
  const db = getDbClient();
  const now = Date.now();
  const since = new Date(now - 3 * 3600 * 1000).toISOString();
  const pastFrom = new Date(now - 26 * 3600 * 1000).toISOString();
  const pastTo = new Date(now - 22 * 3600 * 1000).toISOString();
  // 24時間前に一番近い記録を探す基準。内側の並び替えから外側の列（s.captured_at）は
  // 参照できない（SQLite が受け付けない）ので、値として渡す
  const target = new Date(now - 24 * 3600 * 1000).toISOString();

  const r = await db.execute({
    sql: `WITH latest AS (
            SELECT MAX(s.captured_at) AS at
            FROM play_snapshots s JOIN play_titles t ON t.id = s.title_id
            WHERE s.captured_at >= ? AND t.platform = ?
          )
          SELECT t.external_id, t.name, t.image_url, t.twitch_game_id,
                 s.players, s.rank, s.peak_today, s.prev_rank, s.captured_at,
                 -- 24時間前に一番近い記録。(title_id, captured_at) の索引で前後2時間だけを見る
                 (SELECT p.players FROM play_snapshots p
                  WHERE p.title_id = t.id AND p.captured_at BETWEEN ? AND ?
                  ORDER BY ABS(strftime('%s', p.captured_at) - strftime('%s', ?))
                  LIMIT 1) AS players_24h
          FROM play_snapshots s
          JOIN play_titles t ON t.id = s.title_id
          WHERE s.captured_at = (SELECT at FROM latest) AND t.platform = ?
          ORDER BY s.rank
          LIMIT ?`,
    args: [since, platform, pastFrom, pastTo, target, platform, limit],
  });
  return r.rows.map((row) => ({
    externalId: String(row.external_id),
    name: String(row.name),
    imageUrl: row.image_url ? String(row.image_url) : null,
    twitchGameId: row.twitch_game_id ? String(row.twitch_game_id) : null,
    players: row.players === null ? null : Number(row.players),
    rank: Number(row.rank),
    peakToday: row.peak_today === null ? null : Number(row.peak_today),
    prevRank: row.prev_rank === null ? null : Number(row.prev_rank),
    players24hAgo: row.players_24h === null ? null : Number(row.players_24h),
    capturedAt: String(row.captured_at),
  }));
}
