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
 * スマホに収まらなくなるので、こちらは折り返せる形にしている。
 * 選択中は紫（サイト全体で「選んでいるもの」は紫に統一）。
 */
export function FilterPills({ options }: { options: Option[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <Link
          key={o.href}
          href={o.href}
          className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm transition ${
            o.active
              ? "bg-purple-500 text-white"
              : "bg-white/5 text-gray-400 hover:text-purple-300"
          }`}
        >
          {o.icon}
          {o.label}
        </Link>
      ))}
    </div>
  );
}
