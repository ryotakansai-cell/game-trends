// 配信元のボタンに付ける単色アイコン。
// 各サービスの色は使わず currentColor にしてある（ボタンの紫・グレーに合わせて統一感を出すため）。
// 形は公式ロゴを簡略化したもので、「どのサービスか」が一目で分かることだけを目的にしている

const props = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  "aria-hidden": true,
};

/** Twitch：吹き出しの中に縦線2本 */
export const TwitchIcon = () => (
  <svg {...props} fill="currentColor">
    <path d="M4.5 2 3 5.5V20h4.5v2.5H10l2.5-2.5h3.5l5-5V2H4.5Zm14.5 12-3 3h-4l-2.5 2.5V17H6V4h13v10Z" />
    <path d="M15 7h2v5.5h-2zM10.5 7h2v5.5h-2z" />
  </svg>
);

/** YouTube：角丸の枠の中に再生の三角 */
export const YouTubeIcon = () => (
  <svg {...props} fill="currentColor">
    <path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4a2.5 2.5 0 0 0-1.8 1.8C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8ZM10 15V9l5.2 3L10 15Z" />
  </svg>
);
