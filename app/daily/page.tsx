import type { Metadata } from "next";
import Link from "next/link";
import { getDayRange, dayTitle, shiftDay } from "@/lib/daily";
import { PageHeader } from "@/components/PageHeader";
import { SummaryTabs } from "@/components/SummaryTabs";
import { PLATFORM_NAMES } from "@/lib/platforms";

// 新しい日のまとめは毎朝増えるので、1時間ごとに作り直す
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "日付ごとの配信ランキング",
  description: `${PLATFORM_NAMES}の日本の配信を1日ごとにまとめたランキング。最高同接、前日から伸びた配信者、自己ベスト、見られたゲーム。`,
  alternates: { canonical: "/daily" },
};

/** 日付の一覧。まとめがある最初の日から昨日までを新しい順に並べる。
 *  日付は MIN / MAX の2つだけ読んで、間を JavaScript で埋める（全日付を DB から読まないため） */
export default async function DailyIndexPage() {
  const range = await getDayRange();
  const days: string[] = [];
  if (range) {
    for (let d = range.last; d >= range.first; d = shiftDay(d, -1)) {
      days.push(d);
    }
  }

  // 月ごとにまとめる（2026-10 → [...]）
  const byMonth = new Map<string, string[]>();
  for (const d of days) {
    const month = d.slice(0, 7);
    byMonth.set(month, [...(byMonth.get(month) ?? []), d]);
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-6 sm:py-12">
      <SummaryTabs current="daily" />
      <PageHeader
        eyebrow="DAILY"
        title="日付ごとの配信"
        summary="日本の配信を1日ごとにまとめたランキング（毎朝、前日の分ができます）"
      />

      {[...byMonth].map(([month, monthDays]) => (
        <section key={month} className="mt-10">
          <h2 className="text-lg font-bold text-gray-200">
            {Number(month.slice(0, 4))}年{Number(month.slice(5, 7))}月
          </h2>
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {monthDays.map((d) => (
              <li key={d}>
                <Link
                  href={`/daily/${d}`}
                  className="block rounded-lg border border-white/10 px-3 py-2.5 text-sm text-gray-200 transition hover:border-purple-400/50 hover:text-purple-300"
                >
                  {dayTitle(d)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
