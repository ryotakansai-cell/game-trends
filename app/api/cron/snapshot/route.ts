import { NextRequest, NextResponse } from "next/server";
import { getTopGames, getViewerCountByGame, isRealGame } from "@/lib/twitch";
import { createWriteClient } from "@/lib/supabase";

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
    const supabase = createWriteClient();

    // ③ games を UPSERT
    const gameRows = games.map((g) => ({
      id: g.id,
      name: g.name,
      box_art_url: g.box_art_url,
      igdb_id: g.igdb_id || null,
      updated_at: new Date().toISOString(),
    }));

    const { error: gamesError } = await supabase
      .from("games")
      .upsert(gameRows, { onConflict: "id" });

    if (gamesError) {
      console.error(gamesError);
      return NextResponse.json(
        { step: "games", error: gamesError.message },
        { status: 500 },
      );
    }

    // ④ snapshots を INSERT
    const capturedAt = new Date().toISOString();

    const snapshotRows = games
      .map((g) => ({
        game_id: g.id,
        viewers: viewerCounts.get(g.id) ?? 0,
        captured_at: capturedAt,
      }))
      .filter((row) => row.viewers > 0);

    const { error: snapError } = await supabase
      .from("snapshots")
      .insert(snapshotRows);

    if (snapError) {
      console.error(snapError);
      return NextResponse.json(
        { step: "snapshots", error: snapError.message },
        { status: 500 },
      );
    }

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
