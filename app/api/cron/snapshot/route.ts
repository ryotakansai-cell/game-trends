import { NextRequest, NextResponse } from "next/server";
import {
  getTopGames,
  getViewerCountByGame,
  getTopStreamsPaged,
  getStreamsByUserIds,
  isRealGame,
} from "@/lib/twitch";
import { getDbClient } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // ① 合言葉チェック
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "権限がありません" }, { status: 401 });
  }

  try {
    // ② Twitchからデータを取得（並列）
    const [topGames, viewerCounts, topStreams] = await Promise.all([
      getTopGames(60),
      getViewerCountByGame(4),
      getTopStreamsPaged(8),
    ]);

    const games = topGames.filter(isRealGame);
    const db = getDbClient();

    // ②' 名寄せ済みの配信者は、上位800配信に入っていない時間帯も直接確かめる。
    // 配信者ページの統計（同接・配信時間）を欠けなく出すため。Twitch API は無料で、
    // 100人まで1回で問い合わせられる
    const linked = await db.execute(`
      SELECT platform_id FROM accounts
      WHERE platform = 'twitch' AND creator_id IS NOT NULL
    `);
    const inTop = new Set(topStreams.map((s) => s.user_id));
    const notInTop = linked.rows
      .map((r) => String(r.platform_id))
      .filter((id) => !inTop.has(id));
    const linkedStreams = await getStreamsByUserIds(notInTop);
    // 以降は「上位800 + 圏外だった名寄せ済みの人」をまとめて記録する
    const allStreams = [...topStreams, ...linkedStreams];

    // ?dryRun=1 のときは保存せずに結果だけ返す。
    // 手元から試すたびに本番のDBへ余分な記録が増えるのを防ぐ（DBは本番の1つだけなので）
    if (request.nextUrl.searchParams.get("dryRun") === "1") {
      return NextResponse.json({
        dry_run: true,
        top_streams: topStreams.length,
        linked: linked.rows.length,
        linked_live_outside_top: linkedStreams.length,
      });
    }

    // ③ games を UPSERT
    const gameRows = games.map((g) => ({
      id: g.id,
      name: g.name,
      box_art_url: g.box_art_url,
      igdb_id: g.igdb_id || null,
      updated_at: new Date().toISOString(),
    }));

    await db.batch(
      gameRows.map((g) => ({
        sql: `
      INSERT INTO games (id, name, box_art_url, igdb_id, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        box_art_url = excluded.box_art_url,
        igdb_id = excluded.igdb_id,
        updated_at = excluded.updated_at
    `,
        args: [g.id, g.name, g.box_art_url, g.igdb_id, g.updated_at],
      })),
      "write",
    );
    // ④ snapshots を INSERT
    const capturedAt = new Date().toISOString();

    const snapshotRows = games
      .map((g) => ({
        game_id: g.id,
        viewers: viewerCounts.get(g.id) ?? 0,
        captured_at: capturedAt,
      }))
      .filter((row) => row.viewers > 0);
    await db.batch(
      snapshotRows.map((s) => ({
        sql: `
      INSERT INTO snapshots (game_id, viewers, captured_at)
      VALUES (?,?,?)
    `,
        args: [s.game_id, s.viewers, s.captured_at],
      })),
      "write",
    );

    // ⑤ 配信者ごとの記録を組み立てる（視聴者0の配信は除外）
    const streamerSnapshotRows = allStreams
      .map((s) => ({
        streamer_id: s.user_id,
        viewers: s.viewer_count,
        game_id: s.game_id || null,
        title: s.title, // 配信タイトル（急上昇ページで表示するため保存する）
        captured_at: capturedAt,
      }))
      .filter((row) => row.viewers > 0);

    // ⑥ accounts を UPSERT（全プラットフォーム共通テーブル）
    await db.batch(
      allStreams.map((s) => ({
        sql: `
          INSERT INTO accounts (platform, platform_id, login, display_name, language, updated_at)
          VALUES ('twitch', ?, ?, ?, ?, ?)
          ON CONFLICT(platform, platform_id) DO UPDATE SET
            login = excluded.login,
            display_name = excluded.display_name,
            language = excluded.language,
            updated_at = excluded.updated_at
        `,
        args: [s.user_id, s.user_login, s.user_name, s.language, capturedAt],
      })),
      "write",
    );

    // ⑦ live_snapshots を INSERT
    await db.batch(
      streamerSnapshotRows.map((s) => ({
        sql: `
          INSERT INTO live_snapshots (account_id, viewers, title, game_id, captured_at)
          VALUES (
            -- 新テーブルは内部ID(accounts.id)で管理しているので、
            -- 「TwitchのID → 内部ID」の変換をDB側にやらせている。
            -- ⑥で先にaccountsを更新済みなので必ず見つかる
            (SELECT id FROM accounts WHERE platform = 'twitch' AND platform_id = ?),
            ?, ?, ?, ?
          )
        `,
        args: [s.streamer_id, s.viewers, s.title, s.game_id, s.captured_at],
      })),
      "write",
    );

    return NextResponse.json({
      games: gameRows.length,
      snapshots: snapshotRows.length,
      streamers: allStreams.length,
      linked_live_outside_top: linkedStreams.length,
      streamer_snapshots: streamerSnapshotRows.length,
      captured_at: capturedAt,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
