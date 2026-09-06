import { NextResponse } from "next/server";
import { getTopGames } from "@/lib/twitch";

export async function GET() {
  try {
    const games = await getTopGames(20);
    return NextResponse.json({ count: games.length, games });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
