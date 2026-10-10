"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SITE_NAME } from "@/lib/site";

// 全ページ共通のヘッダー。
//
// これまでは各ページが「← 配信ランキング」というリンクを個別に持っていた。
// それだと「戻る」ことしかできず、ゲーム一覧から配信者一覧へ移るのに
// 一度トップへ戻る必要がある。ヘッダーに集約すると、どこからでも
// どこへでも1回で移動できる。
//
// 「今どこにいるか」を出すために現在のURLが必要で、それは
// usePathname() というブラウザ側の機能を使う。なので "use client" を付けて
// クライアントコンポーネントにしている（データ取得はしないので軽い）。

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** このパスで始まるページなら「現在地」とみなす */
  match: (path: string) => boolean;
};

// アイコンは線画。currentColor にしてあるので、文字色に自動で追従する
const iconProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const LiveIcon = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="9" />
    <path d="M10 8.5l6 3.5-6 3.5z" />
  </svg>
);

const TrendingIcon = () => (
  <svg {...iconProps}>
    <path d="M3 17l6-6 4 4 8-8" />
    <path d="M17 7h4v4" />
  </svg>
);

const GameIcon = () => (
  <svg {...iconProps}>
    <rect x="2" y="7" width="20" height="10" rx="5" />
    <path d="M7 12h2.5M8.25 10.75v2.5" />
    <circle cx="16" cy="11.5" r="0.9" />
    <circle cx="18" cy="13.5" r="0.9" />
  </svg>
);

const CreatorsIcon = () => (
  <svg {...iconProps}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
    <path d="M16 5.2a3.2 3.2 0 0 1 0 5.6" />
    <path d="M18.5 20a5.6 5.6 0 0 0-2.2-4.4" />
  </svg>
);

const NAV: NavItem[] = [
  {
    href: "/",
    label: "ライブ",
    icon: <LiveIcon />,
    match: (p) => p === "/",
  },
  {
    href: "/trending",
    label: "急上昇",
    icon: <TrendingIcon />,
    match: (p) => p.startsWith("/trending"),
  },
  {
    href: "/games",
    label: "ゲーム",
    icon: <GameIcon />,
    match: (p) => p.startsWith("/games"),
  },
  {
    href: "/creators",
    label: "配信者",
    icon: <CreatorsIcon />,
    // 配信者ページ（Twitch単体）も「配信者」の仲間として扱う
    match: (p) => p.startsWith("/creators") || p.startsWith("/streamers"),
  },
];

export function SiteHeader() {
  const pathname = usePathname() ?? "/";

  return (
    <>
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center gap-1 px-6">
          {/* ホーム。サイトのアイコン（app/icon.svg と同じ絵）を置く。
              スマホでは下のタブにナビが移るので、代わりにサイト名を並べて出す */}
          <Link
            href="/"
            aria-label={`${SITE_NAME} ホーム`}
            className="mr-2 flex shrink-0 items-center gap-2 rounded-lg py-2.5 sm:p-2"
          >
            {/* 静的な小さいSVGなので next/image を通さず img で読む */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" width={26} height={26} />
            <span className="text-sm font-bold text-white sm:hidden">
              {SITE_NAME}
            </span>
          </Link>

          {/* PC：上の下線ナビ。スマホでは画面に収まらず「配信者」が切れていたので、
              スマホは下のタブバーに切り替える */}
          <nav className="hidden min-w-0 flex-1 gap-1 sm:flex">
            {NAV.map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  // 現在地は紫＋下線、それ以外はグレーでhoverすると白。
                  // 「今ここ」と「触れている」だけに紫を使い、意味を濁らせない
                  className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3.5 text-sm transition ${
                    active
                      ? "border-purple-400 text-purple-300"
                      : "border-transparent text-gray-400 hover:text-gray-100"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  {item.icon}
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      {/* スマホ：画面下に固定するタブバー（アプリと同じ形）。
          4つ全部が常に見え、親指で押しやすい。下のページ本文が隠れないよう、
          layout の body に同じ高さの下余白を入れてある */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-white/10 bg-[#0a0a0a]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
        {NAV.map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${
                active ? "text-purple-300" : "text-gray-400"
              }`}
              aria-current={active ? "page" : undefined}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
