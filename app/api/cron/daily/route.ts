import { NextRequest, NextResponse } from "next/server";
import { rollupPendingDays, deleteOldRecords } from "@/lib/daily-stats";
import { saveFinalSummaries, clearSummariesFrom } from "@/lib/daily";

export const dynamic = "force-dynamic";

// 1日1回（日本時間の朝6時前）に、前日の毎時の記録を日ごとの集計にまとめ、
// 90日より古い毎時の記録を消す。cron-worker から呼ばれる
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "権限がありません" }, { status: 401 });
  }

  // ?dryRun=1 では何も書かない（集計は書き込みそのものなので、確かめるだけにする）。
  // Bluesky の投稿の確認は /api/cron/bluesky?kind=daily&dryRun=1 で行う
  if (request.nextUrl.searchParams.get("dryRun") === "1") {
    return NextResponse.json({ dry_run: true, note: "dryRun では集計しない" });
  }

  try {
    // ?from=2026-09-13 で、その日からまとめ直す（日ごとの集計に列を足したとき、過去の日も埋めるため）
    const from = request.nextUrl.searchParams.get("from");
    if (from !== null && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      return NextResponse.json(
        { error: "from は 2026-10-01 の形で" },
        { status: 400 },
      );
    }

    // 順番が大事：まとめてから消す。まとめる途中で失敗したら、消す処理には進まない
    const rolledUp = await rollupPendingDays(from ?? undefined);

    // 日付ページのまとめを保存する（lib/daily.ts の saveFinalSummaries）。毎時の記録を消す前にやる
    // （まとめの「見られたゲーム」は毎時の記録から作るので、消した後だと空になる）。
    // まとめ直した日は daily_stats が変わったので、保存も消して作り直させる。
    // 保存に失敗しても日付ページはその場で作れるので、古い記録の削除は止めない
    let summaries: string[] | string;
    try {
      if (from !== null) await clearSummariesFrom(from);
      summaries = await saveFinalSummaries();
    } catch (e) {
      console.error("日付ページのまとめの保存に失敗", e);
      summaries = `失敗: ${String(e)}`;
    }

    const deleted = await deleteOldRecords();
    return NextResponse.json({
      rolled_up: rolledUp,
      saved_summaries: summaries,
      ...deleted,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
