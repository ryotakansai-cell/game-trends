"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

const HomeIcon = () => (
  <svg {...iconProps} width={20} height={20}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
  </svg>
);

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
    <header className="border-b border-white/10">
      <div className="mx-auto flex max-w-6xl items-center gap-1 px-6">
        {/* ホーム。文字は置かずアイコンだけにして、ナビの項目と競合させない */}
        <Link
          href="/"
          aria-label="ホーム"
          className="mr-2 shrink-0 rounded-lg p-2 text-gray-400 transition hover:bg-white/5 hover:text-purple-300"
        >
          <HomeIcon />
        </Link>

        {/* 項目が増えても潰れないよう、狭い画面では横スクロールさせる */}
        <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {NAV.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                // 現在地は紫＋下線、それ以外はグレーでhoverすると白。
                // 「今ここ」と「触れている」だけに紫を使い、意味を濁らせない
                className={`flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-3.5 text-[13px] transition sm:px-3 sm:text-sm ${
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
  );
}
