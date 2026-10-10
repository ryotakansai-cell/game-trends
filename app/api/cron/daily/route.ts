import { NextRequest, NextResponse } from "next/server";
import { rollupPendingDays, deleteOldRecords } from "@/lib/daily-stats";

export const dynamic = "force-dynamic";

// 1日1回（日本時間の朝6時前）に、前日の毎時の記録を日ごとの集計にまとめ、
// 90日より古い毎時の記録を消す。cron-worker から呼ばれる
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "権限がありません" }, { status: 401 });
  }

  // ?dryRun=1 では何も書かない（集計は書き込みそのものなので、確かめるだけにする）
  if (request.nextUrl.searchParams.get("dryRun") === "1") {
    return NextResponse.json({ dry_run: true, note: "dryRun では集計しない" });
  }

  try {
    // 順番が大事：まとめてから消す。まとめる途中で失敗したら、消す処理には進まない
    const rolledUp = await rollupPendingDays();
    const deleted = await deleteOldRecords();
    return NextResponse.json({ rolled_up: rolledUp, ...deleted });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
