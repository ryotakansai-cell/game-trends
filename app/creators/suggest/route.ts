import { NextResponse } from "next/server";
import { getSuggestEntries } from "@/lib/streamer-list";
import { accountHref } from "@/lib/platforms";

// 検索欄の候補の一覧（JSON）。顔ぶれは日ごとの集計から作るので、数時間に1回作り直せば十分。
// 作り置きなので、何人が検索欄を開いても DB を読むのは作り直しのときだけ
export const revalidate = 21600;

export async function GET() {
  const entries = await getSuggestEntries().catch(() => []);
  // 名前・URL 用の名前（ローマ字で探せるように）・リンク先・配信元だけに絞る（送る量を小さくするため）
  return NextResponse.json(
    entries.map((e) => ({
      n: e.displayName,
      l: e.login,
      h: accountHref(e),
      p: e.platforms,
    })),
  );
}
