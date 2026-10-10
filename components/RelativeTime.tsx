"use client";

import { useSyncExternalStore } from "react";

/**
 * 「12分前」のような相対時刻を出す。
 *
 * サーバーで「◯分前」を計算すると、ページが作り置き（キャッシュ）されている間は
 * 数字が古いまま固まってしまう。なのでブラウザ側で、見た瞬間の時刻から計算する。
 *
 * 「今の時刻」は React の外で勝手に進む値なので、useSyncExternalStore で読む
 * （useEffect の中で setState する書き方は、余計な再描画を招くので React が非推奨にしている）。
 * サーバーで作るHTMLには「今」が無いので日本時間の「10:23」を出し、
 * ブラウザで動き出してから「◯分前」に置き換わる。こうしないと、サーバーと
 * ブラウザで表示が食い違って React が警告を出す（hydration mismatch）。
 */

// 1分ごとに「時刻が変わった」と React に知らせる
function subscribe(onChange: () => void) {
  const id = setInterval(onChange, 60_000);
  return () => clearInterval(id);
}
// 分単位に丸める。丸めないと呼ぶたびに値が変わり、React が無限に再描画しようとする
const getNow = () => Math.floor(Date.now() / 60_000) * 60_000;
// サーバーでは「今」を出さない
const getServerNow = () => null;

export function RelativeTime({ iso }: { iso: string }) {
  const now = useSyncExternalStore(subscribe, getNow, getServerNow);
  const time = new Date(iso);

  if (now === null) {
    return (
      <time dateTime={iso}>
        {time.toLocaleTimeString("ja-JP", {
          timeZone: "Asia/Tokyo",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </time>
    );
  }

  const minutes = Math.max(0, Math.floor((now - time.getTime()) / 60_000));
  const label =
    minutes < 1
      ? "たった今"
      : minutes < 60
        ? `${minutes}分前`
        : `${Math.floor(minutes / 60)}時間前`;
  return <time dateTime={iso}>{label}</time>;
}
