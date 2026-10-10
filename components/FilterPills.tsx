import Link from "next/link";

type Option = {
  label: string;
  href: string;
  active: boolean;
  /** 文字の前に出す単色のアイコン（currentColor で文字色に追従する） */
  icon?: React.ReactNode;
};

/**
 * 配信元などの「増えていく選択肢」を、離れた丸ボタンで並べる。
 * つながったタブ（SegmentedTabs）だと選択肢が増えるたびに横に伸びて
 * 窮屈になるので、こちらは別々のボタンにしている。
 * スマホでは1行に収めて横にスクロールさせる（画面上部に固定するので、
 * 折り返して2行になると画面を占める割合が増えて見づらくなるため）。
 * 選択中は紫（サイト全体で「選んでいるもの」は紫に統一）。
 */
export function FilterPills({ options }: { options: Option[] }) {
  return (
    // スクロールバーは隠す（細い1行のバーに出ると、それだけで邪魔に見えるため）
    <div className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none] sm:flex-wrap sm:gap-2 [&::-webkit-scrollbar]:hidden">
      {options.map((o) => (
        <Link
          key={o.href}
          href={o.href}
          className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs transition sm:px-4 sm:py-1.5 sm:text-sm ${
            o.active
              ? "bg-purple-500 text-white"
              : "bg-white/5 text-gray-400 hover:text-purple-300"
          }`}
        >
          {/* スマホでは地域の切り替えと1行に並べるので、幅を取るアイコンは出さない */}
          {o.icon && <span className="hidden sm:inline-flex">{o.icon}</span>}
          {o.label}
        </Link>
      ))}
    </div>
  );
}
