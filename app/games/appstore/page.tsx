import Image from "next/image";
import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { GameTabs } from "@/components/GameTabs";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { getAppStoreRanking, type AppStoreChart } from "@/lib/appstore";

export const metadata: Metadata = {
  title: "App Store ゲームランキング（日本）",
  description:
    "iPhoneのApp Storeで、日本のセールス上位・無料上位のゲームのランキング。",
  alternates: { canonical: "/games/appstore" },
};

type Props = { searchParams: Promise<{ chart?: string }> };

export default async function AppStoreGamesPage({ searchParams }: Props) {
  const { chart } = await searchParams;
  const current: AppStoreChart = chart === "free" ? "free" : "grossing";
  const games = await getAppStoreRanking(current, 50);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-6 sm:py-12">
      <PageHeader
        eyebrow="GAMES"
        title="ゲームランキング"
        summary={
          <>
            App Store（iPhone）の日本のゲーム ・{" "}
            {current === "grossing"
              ? "売上の多い順"
              : "無料でよくダウンロードされている順"}
            <span className="mt-0.5 block text-gray-500">更新：1時間ごと</span>
          </>
        }
        // セールス / 無料 はずっと2択なので、つながったスイッチ（地域の切り替えと同じ形）
        region={
          <SegmentedTabs
            options={[
              {
                label: "セールス",
                href: "/games/appstore",
                active: current === "grossing",
              },
              {
                label: "無料",
                href: "/games/appstore?chart=free",
                active: current === "free",
              },
            ]}
          />
        }
        filters={<GameTabs current="appstore" />}
      />

      <ol className="mt-8 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        {games.map((g) => (
          <li
            key={g.id}
            className="border-t border-white/5 first:border-t-0 sm:[&:nth-child(2)]:border-t-0"
          >
            <a
              href={g.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-3 py-3"
            >
              <span className="w-6 shrink-0 text-right text-sm tabular-nums text-gray-400">
                {g.rank}
              </span>
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-white/5">
                <Image
                  src={g.iconUrl}
                  alt={g.name}
                  fill
                  className="object-cover"
                  unoptimized
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-gray-100 group-hover:text-purple-300">
                  {g.name}
                </p>
                <p className="mt-0.5 truncate text-xs text-gray-500">
                  {g.developer}
                </p>
              </div>
            </a>
          </li>
        ))}
      </ol>
    </main>
  );
}
