import { SITE_URL } from "@/lib/site";

/** 「Xで共有」ボタン。押すと X の投稿画面が、文と URL が入った状態で開く。
 *  投稿するのは見た人自身のアカウントで、こちらは X の API を使わない（費用0円・審査なし）。
 *  投稿に付く画像は、そのページの OGP 画像（opengraph-image）が X 側で自動で出る */
export function ShareOnX({ text, path }: { text: string; path: string }) {
  const params = new URLSearchParams({ text, url: `${SITE_URL}${path}` });
  return (
    <a
      href={`https://x.com/intent/post?${params}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1 text-xs text-gray-400 transition hover:border-purple-400 hover:text-purple-300"
    >
      {/* X のロゴ（単色。サイトの決まりで配信元のアイコンも色を付けていないので合わせる） */}
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
      >
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
      Xで共有
    </a>
  );
}
