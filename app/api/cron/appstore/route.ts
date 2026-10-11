import { NextRequest, NextResponse } from "next/server";
import {
  isAppStoreChart,
  parseAppStoreFeed,
  saveAppStoreRanking,
} from "@/lib/appstore";

export const dynamic = "force-dynamic";

// App Store の順位表を受け取って保存する。
// ほかの cron と違い、データを自分で取りに行かず、GitHub Actions が取った RSS を本文で受け取る
// （Apple が Cloudflare からの読み取りを拒否するため。lib/appstore.ts の冒頭を参照）。
// POST /api/cron/appstore?chart=grossing|free  本文：RSS の JSON そのまま。?dryRun=1 は保存しない
export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "権限がありません" }, { status: 401 });
  }
  const chart = request.nextUrl.searchParams.get("chart");
  if (!isAppStoreChart(chart)) {
    return NextResponse.json(
      { error: "chart は grossing か free" },
      { status: 400 },
    );
  }
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";

  let games;
  try {
    games = parseAppStoreFeed(await request.json());
  } catch (e) {
    return NextResponse.json(
      { error: `RSS を読み解けません: ${String(e).slice(0, 200)}` },
      { status: 400 },
    );
  }
  // Apple がエラーの代わりに空や途中までの一覧を返すことがある。
  // 少なすぎる順位表を保存すると、ページが数件だけの一覧になるので受け付けない
  if (games.length < 20) {
    return NextResponse.json(
      { error: `件数が少なすぎます（${games.length}件）` },
      { status: 400 },
    );
  }

  const capturedAt = new Date().toISOString();
  if (!dryRun) await saveAppStoreRanking(chart, games, capturedAt);
  return NextResponse.json({
    dry_run: dryRun,
    chart,
    games: games.length,
    top: games.slice(0, 3).map((g) => g.name),
    captured_at: capturedAt,
  });
}
