import Link from "next/link";

// タブ1つ分の情報
type Option = {
  label: string; // 画面に出す文字（"日本" や "Global"）
  href: string; // 押したときの遷移先URL
  active: boolean; // 今これが選ばれているか
  /** 文字の代わりに出すアイコン。渡すとアイコンだけになり、label は読み上げとマウスを乗せたときの説明に使う */
  icon?: React.ReactNode;
};

/**
 * 1つの枠の中で選択肢を切り替えるタブ（セグメント型）。
 * リンクの組み立て方はページごとに違うので、呼び出す側が href を作って渡す。
 * この部品は「見た目」だけに責任を持つ。
 */
export function SegmentedTabs({ options }: { options: Option[] }) {
  return (
    <div className="inline-flex w-fit shrink-0 gap-1 rounded-lg bg-white/5 p-1">
      {options.map((o) => (
        <Link
          key={o.href}
          href={o.href}
          aria-label={o.icon ? o.label : undefined}
          title={o.icon ? o.label : undefined}
          // スマホでは小さめにする。アイコンだけのときは、文字のボタンと同じ高さ（24px / sm 以上 32px）にそろえる
          className={`flex items-center whitespace-nowrap rounded-md text-xs transition sm:text-sm ${
            o.icon
              ? "h-6 px-2 sm:h-8 sm:px-2.5"
              : "px-2.5 py-1 sm:px-3.5 sm:py-1.5"
          } ${
            o.active
              ? "bg-purple-500 text-white"
              : "text-gray-400 hover:text-gray-200"
          }`}
        >
          {o.icon ?? o.label}
        </Link>
      ))}
    </div>
  );
}
