import Link from "next/link";

/**
 * ナビの「まとめ」の中の切り替え：今日 ／ 日ごとのまとめ。
 * どちらも「1日単位で振り返る」ページなので、1つのタブにまとめ、ページの上でこの2つを行き来する。
 * 以前は「急上昇」の中に「急上昇 ／ 今日 ／ 日ごとのまとめ」として置いていたが、急上昇のページが
 * 急上昇だけを見たい人にとって余計な物の入った箱に見えたので、「まとめ」をナビに独立させた（2026-10-17）。
 * 選択中は紫の塗り（UI の約束ごと：紫は「現在地」と「hover」にだけ使う）
 */
export type SummaryTab = "today" | "daily";

const TABS: { key: SummaryTab; label: string; href: string }[] = [
  { key: "today", label: "今日", href: "/today" },
  { key: "daily", label: "日ごとのまとめ", href: "/daily" },
];

export function SummaryTabs({ current }: { current: SummaryTab }) {
  return (
    <nav aria-label="まとめの切り替え" className="mb-6 flex gap-2">
      {TABS.map((t) =>
        t.key === current ? (
          <span
            key={t.key}
            aria-current="page"
            className="rounded-full bg-purple-600 px-3.5 py-1.5 text-xs font-semibold text-white sm:text-sm"
          >
            {t.label}
          </span>
        ) : (
          <Link
            key={t.key}
            href={t.href}
            className="rounded-full bg-white/5 px-3.5 py-1.5 text-xs text-gray-300 transition hover:text-purple-300 sm:text-sm"
          >
            {t.label}
          </Link>
        ),
      )}
    </nav>
  );
}
