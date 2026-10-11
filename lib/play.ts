// ゲームを「遊んでいる人数」の記録（Steam・Roblox など）。プラットフォームをまたいで共通。
// play_titles（マスタ）と play_snapshots（毎時の人数）の2つの表を使う。
// 配信の accounts / live_snapshots と同じ考え方で、名前や画像は毎時保存しない。
import { getDbClient, batchInChunks } from "@/lib/db";

// App Store は「セールス」と「無料」で順位表が別なので、2つの platform に分けて持つ
// （同じアプリが両方に入ると、マスタの行も2つになる）
export type PlayPlatform =
  "steam" | "roblox" | "appstore_grossing" | "appstore_free";

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
  developer?: string | null; // App Store のみ
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
      sql: `INSERT INTO play_titles (platform, external_id, name, image_url, twitch_game_id, developer, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(platform, external_id) DO UPDATE SET
              name = excluded.name,
              image_url = excluded.image_url,
              twitch_game_id = excluded.twitch_game_id,
              developer = excluded.developer,
              updated_at = excluded.updated_at`,
      args: [
        platform,
        t.externalId,
        t.name,
        t.imageUrl,
        t.twitchGameId,
        t.developer ?? null,
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
  players24hAgo: number | null; // 24時間前（compareHours を渡したらその時間前）に一番近い記録（前後2時間以内）。無ければ null
  rank24hAgo: number | null; // 同じ時刻の順位
  developer: string | null;
  capturedAt: string;
};

/** 最新の収集の順位表。24時間前の人数と順位も添える（急上昇・前日比のため）。
 *  freshHours より古い記録しか無ければ空にする（収集が止まったまま古い順位を出し続けないため）。
 *  App Store は GitHub Actions の定期実行で集めていて数時間遅れることがあるので、長めに渡す */
export async function getPlayRanking(
  platform: PlayPlatform,
  limit = 50,
  freshHours = 3,
  // 何時間前と比べるか。ふつうは24時間前。記録が1日分たまっていないあいだ、
  // 「いま話題のゲーム」（lib/game-buzz.ts）はもっと短い時間で比べる
  compareHours = 24,
): Promise<PlayRankingRow[]> {
  const db = getDbClient();
  const now = Date.now();
  const since = new Date(now - freshHours * 3600 * 1000).toISOString();
  const pastFrom = new Date(
    now - (compareHours + 2) * 3600 * 1000,
  ).toISOString();
  const pastTo = new Date(now - (compareHours - 2) * 3600 * 1000).toISOString();
  // 比べる時刻に一番近い記録を探す基準。内側の並び替えから外側の列（s.captured_at）は
  // 参照できない（SQLite が受け付けない）ので、値として渡す
  const target = new Date(now - compareHours * 3600 * 1000).toISOString();

  const r = await db.execute({
    sql: `WITH latest AS (
            SELECT MAX(s.captured_at) AS at
            FROM play_snapshots s JOIN play_titles t ON t.id = s.title_id
            WHERE s.captured_at >= ? AND t.platform = ?
          )
          SELECT t.external_id, t.name, t.image_url, t.twitch_game_id, t.developer,
                 s.players, s.rank, s.peak_today, s.prev_rank, s.captured_at,
                 -- 24時間前に一番近い記録。(title_id, captured_at) の索引で前後2時間だけを見る
                 (SELECT p.players FROM play_snapshots p
                  WHERE p.title_id = t.id AND p.captured_at BETWEEN ? AND ?
                  ORDER BY ABS(strftime('%s', p.captured_at) - strftime('%s', ?))
                  LIMIT 1) AS players_24h,
                 (SELECT p.rank FROM play_snapshots p
                  WHERE p.title_id = t.id AND p.captured_at BETWEEN ? AND ?
                  ORDER BY ABS(strftime('%s', p.captured_at) - strftime('%s', ?))
                  LIMIT 1) AS rank_24h
          FROM play_snapshots s
          JOIN play_titles t ON t.id = s.title_id
          WHERE s.captured_at = (SELECT at FROM latest) AND t.platform = ?
          ORDER BY s.rank
          LIMIT ?`,
    args: [
      since,
      platform,
      pastFrom,
      pastTo,
      target,
      pastFrom,
      pastTo,
      target,
      platform,
      limit,
    ],
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
    rank24hAgo: row.rank_24h === null ? null : Number(row.rank_24h),
    developer: row.developer ? String(row.developer) : null,
    capturedAt: String(row.captured_at),
  }));
}
