import { NextRequest, NextResponse } from "next/server";
import { getTopGames, getViewerCountByGame, isRealGame } from "@/lib/twitch";
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
    const [topGames, viewerCounts] = await Promise.all([
      getTopGames(60),
      getViewerCountByGame(4),
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

    return NextResponse.json({
      games: gameRows.length,
      snapshots: snapshotRows.length,
      captured_at: capturedAt,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
