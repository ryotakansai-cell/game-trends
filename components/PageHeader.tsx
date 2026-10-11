/**
 * 各ページ共通の見出し。
 *
 * PC:
 *   LIVE RANKING
 *   ライブランキング
 *   上位40配信で30.5万人が視聴中
 *   (すべて)(Twitch)(YouTube)(ツイキャス)      [日本|Global] [▦|☰]   ← 操作は1行。左は「何を見るか」、右は「どう見るか」
 *
 * スマホ:
 *   LIVE RANKING
 *   ライブランキング                           ← 見出しは小さめ
 *   上位40配信で30.5万人が視聴中
 *   (すべて)(Twitch)(YouTube)(ツイキャス)      ← 配信元だけの1行。スクロールしても上に固定
 *   [日本|Global]                   [▦|☰]     ← 固定しない行。表示の形は一覧のすぐ上に来る
 *
 * 配信元の絞り込みはこのサイトの主役（プラットフォームごとにランキングを見られる）なので、
 * スマホでは上に固定する行を配信元だけに使い、なるべく全部が見えるようにする。
 * 地域（日本/Global）は主に日本の人向けのサイトでは変える人が少ないので、固定しない行に置く。
 * 以前は配信元と地域を1行に詰めていたが、配信元のボタンが3つほどしか見えなかった（2026-10-11）。
 *
 * 地域は「ずっと2択の切り替え」、配信元は「今後増えていく選択肢」なので、
 * 見た目を分けている（つながったスイッチ / 離れた丸ボタン）。
 * 右側のスイッチは増えないので幅が変わらない。配信元が増えたら、PC は左側だけが折り返し、スマホは横に送る。
 * ページごとに要らない部分は渡さなければ出ない。
 */
export function PageHeader({
  eyebrow,
  title,
  summary,
  region,
  view,
  filters,
}: {
  /** 見出しの上の小さな英字。紫は「現在地」にだけ使う決まりなので、ページ名を表すここは紫にする */
  eyebrow: string;
  title: string;
  /** 見出しの下の説明（件数や視聴者数、最終更新など） */
  summary?: React.ReactNode;
  /** 地域などの2択の切り替え（SegmentedTabs）。PC は操作の行の右、スマホは固定しない行の左 */
  region?: React.ReactNode;
  /** 表示の形の切り替え（ViewToggle）。PC は地域の右、スマホは固定しない行の右 */
  view?: React.ReactNode;
  /** 配信元などの絞り込み（FilterPills）。スマホでは上に固定する */
  filters?: React.ReactNode;
}) {
  const hasSide = region || view;
  return (
    <>
      <header>
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
      </header>

      {/* 操作の行は header の外（main の直下）に置く。sticky は親の要素の中でしか
          固定されないので、header の中に入れると header と一緒に流れて行ってしまう */}
      {(filters || hasSide) && (
        // スマホ：配信元だけの1行を、スクロールしても画面上部に固定する。
        // 背景を少し透かしてぼかし、下を流れる動画と重なっても文字が読めるようにする。
        // -mx-6 px-6 で左右いっぱいまで背景を広げる（main の余白と相殺）。
        // PC：配信元（左）と切り替え（右）を1行に並べる。固定はしない
        <div
          className={`-mx-6 mt-3 px-6 sm:mx-0 sm:mt-5 sm:flex sm:items-start sm:justify-between sm:gap-4 sm:px-0 ${
            filters
              ? "sticky top-0 z-20 bg-[#0a0a0a]/85 py-2 backdrop-blur sm:static sm:bg-transparent sm:py-0 sm:backdrop-blur-none"
              : "hidden sm:flex"
          }`}
        >
          {filters && <div className="min-w-0 sm:flex-1">{filters}</div>}
          {hasSide && (
            <div className="hidden shrink-0 items-center gap-2 sm:ml-auto sm:flex">
              {region}
              {view}
            </div>
          )}
        </div>
      )}
      {/* スマホだけの、固定しない行（地域は左、表示の形は右） */}
      {hasSide && (
        <div className="mt-3 flex items-center justify-between gap-2 sm:hidden">
          {region ?? <span />}
          {view}
        </div>
      )}
    </>
  );
}
