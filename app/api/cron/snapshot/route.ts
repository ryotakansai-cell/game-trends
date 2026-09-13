import { NextRequest, NextResponse } from "next/server";
import {
  getTopGames,
  getViewerCountByGame,
  getTopStreamsPaged,
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

    // ⑤ streamers を UPSERT
    const streamerRows = topStreams.map((s) => ({
      id: s.user_id,
      login: s.user_login,
      display_name: s.user_name,
      updated_at: capturedAt,
    }));

    await db.batch(
      streamerRows.map((s) => ({
        sql: `
          INSERT INTO streamers (id, login, display_name, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            login = excluded.login,
            display_name = excluded.display_name,
            updated_at = excluded.updated_at
        `,
        args: [s.id, s.login, s.display_name, s.updated_at],
      })),
      "write",
    );

    // ⑥ streamer_snapshots を INSERT
    const streamerSnapshotRows = topStreams
      .map((s) => ({
        streamer_id: s.user_id,
        viewers: s.viewer_count,
        game_id: s.game_id || null,
        captured_at: capturedAt,
      }))
      .filter((row) => row.viewers > 0);

    await db.batch(
      streamerSnapshotRows.map((s) => ({
        sql: `
          INSERT INTO streamer_snapshots (streamer_id, viewers, game_id, captured_at)
          VALUES (?, ?, ?, ?)
        `,
        args: [s.streamer_id, s.viewers, s.game_id, s.captured_at],
      })),
      "write",
    );

    return NextResponse.json({
      games: gameRows.length,
      snapshots: snapshotRows.length,
      streamers: streamerRows.length,
      streamer_snapshots: streamerSnapshotRows.length,
      captured_at: capturedAt,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
