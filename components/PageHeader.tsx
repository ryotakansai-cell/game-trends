/**
 * 各ページ共通の見出し。
 *
 *   LIVE RANKING              [日本|Global]   ← 小さな英字（現在地）と、右上に地域の切り替え
 *   ライブランキング
 *   上位40配信で30.5万人が視聴中
 *   (すべて) (Twitch) (YouTube)               ← 配信元のボタン
 *
 * 地域は「ずっと2択の切り替え」、配信元は「今後増えていく選択肢」なので、
 * 見た目を分けて置き場所も離している（右上のスイッチ / 下の丸ボタン）。
 * ページごとに要らない部分は渡さなければ出ない。
 */
export function PageHeader({
  eyebrow,
  title,
  summary,
  region,
  filters,
}: {
  /** 見出しの上の小さな英字。紫は「現在地」にだけ使う決まりなので、ページ名を表すここは紫にする */
  eyebrow: string;
  title: string;
  /** 見出しの下の一文（件数や視聴者数など） */
  summary?: React.ReactNode;
  /** 右上に置く地域の切り替え（SegmentedTabs） */
  region?: React.ReactNode;
  /** 見出しの下に置く絞り込み（FilterPills） */
  filters?: React.ReactNode;
}) {
  return (
    <header>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-purple-400">
            {eyebrow}
          </p>
          <h1 className="mt-1 text-3xl font-bold text-white sm:text-4xl">
            {title}
          </h1>
          {/* 説明文は見出しと同じ塊に入れる。スマホで地域の切り替えが折り返したとき、
              文字は文字、ボタンはボタンでまとまって並ぶようにするため */}
          {summary && <p className="mt-2 text-sm text-gray-400">{summary}</p>}
        </div>
        {region}
      </div>
      {filters && <div className="mt-4">{filters}</div>}
    </header>
  );
}
