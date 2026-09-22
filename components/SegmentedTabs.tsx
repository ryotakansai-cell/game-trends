import Link from "next/link";

// タブ1つ分の情報
type Option = {
  label: string; // 画面に出す文字（"JP" や "Twitch"）
  href: string; // 押したときの遷移先URL
  active: boolean; // 今これが選ばれているか
};

/**
 * 1つの枠の中で選択肢を切り替えるタブ（セグメント型）。
 * リンクの組み立て方はページごとに違うので、呼び出す側が href を作って渡す。
 * この部品は「見た目」だけに責任を持つ。
 */
export function SegmentedTabs({ options }: { options: Option[] }) {
  return (
    <div className="inline-flex w-fit gap-1 rounded-lg bg-white/5 p-1">
      {options.map((o) => (
        <Link
          key={o.href}
          href={o.href}
          className={`rounded-md px-3.5 py-1.5 text-sm transition ${
            o.active
              ? "bg-purple-500 text-white"
              : "text-gray-400 hover:text-gray-200"
          }`}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}
