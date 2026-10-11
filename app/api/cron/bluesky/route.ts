import { NextRequest, NextResponse } from "next/server";
import { postDailyRanking, postLiveRanking } from "@/lib/bluesky";

export const dynamic = "force-dynamic";

// Bluesky への投稿。cron-worker が決まった時刻に呼ぶ（時刻は lib/bluesky.ts の先頭を参照）。
//   ?kind=daily … 前日のまとめ
//   ?kind=live  … いま見られている配信
//   &dryRun=1   … 投稿せず、文面とログインできるかだけ返す
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "権限がありません" }, { status: 401 });
  }

  const kind = request.nextUrl.searchParams.get("kind");
  const preview = request.nextUrl.searchParams.get("dryRun") === "1";
  if (kind !== "daily" && kind !== "live") {
    return NextResponse.json(
      { error: "kind は daily か live" },
      { status: 400 },
    );
  }

  try {
    const report =
      kind === "daily"
        ? await postDailyRanking(preview)
        : await postLiveRanking(preview);
    return NextResponse.json({ kind, dry_run: preview, ...report });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: String(e).slice(0, 300) },
      { status: 500 },
    );
  }
}
