import { NextRequest, NextResponse } from "next/server";
import { collectSteam } from "@/lib/steam";
import { collectRoblox } from "@/lib/roblox";
import { savePlaySnapshot } from "@/lib/play";

export const dynamic = "force-dynamic";

// 毎時、ゲームを「遊んでいる人数」を記録する（Steam の上位100本・Roblox の上位約100本）。
// cron-worker から呼ばれる。?dryRun=1 は保存せずに件数だけ返す。
// 片方が取れなくても、もう片方は記録する（Roblox は公式に案内された API ではないため）
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "権限がありません" }, { status: 401 });
  }
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const capturedAt = new Date().toISOString();

  const [steam, roblox] = await Promise.allSettled([
    collectSteam(),
    collectRoblox(),
  ]);

  const result: Record<string, unknown> = {
    dry_run: dryRun,
    captured_at: capturedAt,
  };
  for (const [platform, r] of [
    ["steam", steam],
    ["roblox", roblox],
  ] as const) {
    if (r.status === "rejected") {
      result[platform] = { error: String(r.reason).slice(0, 200) };
      continue;
    }
    result[platform] = {
      games: r.value.rows.length,
      titles_updated: r.value.titles.length,
      hidden_players: r.value.rows.filter((x) => x.players === null).length,
    };
    if (!dryRun && r.value.rows.length > 0) {
      await savePlaySnapshot(
        platform,
        r.value.titles,
        r.value.rows,
        capturedAt,
      );
    }
  }
  return NextResponse.json(result);
}
