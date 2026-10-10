/**
 * 各ページ共通の見出し。
 *
 * PC:
 *   LIVE RANKING              [日本|Global]   ← 小さな英字（現在地）と、右上に地域の切り替え
 *   ライブランキング
 *   上位40配信で30.5万人が視聴中
 *   (すべて) (Twitch) (YouTube)               ← 配信元のボタン
 *
 * スマホ:
 *   LIVE RANKING
 *   ライブランキング                           ← 見出しは小さめ
 *   上位40配信で30.5万人が視聴中
 *   (すべて)(Twitch)(YouTube)   [日本|Global]  ← 1行にまとめ、スクロールしても上に固定
 *
 * 地域は「ずっと2択の切り替え」、配信元は「今後増えていく選択肢」なので、
 * 見た目を分けている（つながったスイッチ / 離れた丸ボタン）。
 * スマホで1行にまとめるのは、見出しまわりが1画面目の約4割を占めていて、
 * 動画が下に押し出されていたため。ページごとに要らない部分は渡さなければ出ない。
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
  /** 見出しの下の説明（件数や視聴者数、最終更新など） */
  summary?: React.ReactNode;
  /** 地域の切り替え（SegmentedTabs）。PCは右上、スマホは絞り込みの行の右端 */
  region?: React.ReactNode;
  /** 配信元の絞り込み（FilterPills） */
  filters?: React.ReactNode;
}) {
  return (
    <>
      <header>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.2em] text-purple-400 sm:text-xs">
              {eyebrow}
            </p>
            <h1 className="mt-1 text-2xl font-bold text-white sm:text-4xl">
              {title}
            </h1>
            {/* 説明文は見出しと同じ塊に入れる（文字は文字、ボタンはボタンでまとめるため） */}
            {summary && (
              <div className="mt-1.5 text-xs text-gray-400 sm:mt-2 sm:text-sm">
                {summary}
              </div>
            )}
          </div>
          {region && <div className="hidden sm:block">{region}</div>}
        </div>
      </header>

      {/* 絞り込みの行は header の外（main の直下）に置く。sticky は親の要素の中でしか
          固定されないので、header の中に入れると header と一緒に流れて行ってしまう */}
      {(filters || region) && (
        // スマホ：スクロールしても画面上部に固定する1行のバー。
        // 背景を少し透かしてぼかし、下を流れる動画と重なっても文字が読めるようにする。
        // -mx-6 px-6 で左右いっぱいまで背景を広げる（main の余白と相殺）
        <div className="sticky top-0 z-20 -mx-6 mt-3 flex items-center gap-2 bg-[#0a0a0a]/85 px-6 py-2 backdrop-blur sm:static sm:mx-0 sm:mt-4 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none">
          <div className="min-w-0 flex-1">{filters}</div>
          {region && <div className="sm:hidden">{region}</div>}
        </div>
      )}
    </>
  );
}
