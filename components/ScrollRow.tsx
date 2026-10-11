"use client";

import { useEffect, useRef, useState } from "react";

/** 横にスクロールする1行。右にまだ隠れたボタンがあるあいだだけ、右端をうっすら暗くする。
 *  配信元が増えてスマホの1行に収まらなくなったとき、端で切れたボタンに気づいてもらうため。
 *  端まで送ったら暗さを消す（最後のボタンまで暗いままだと、押せないように見えるため） */
export function ScrollRow({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 4px の余裕は、端数のピクセルで「まだある」と判定され続けるのを防ぐため
    const update = () =>
      setHasMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    update();
    el.addEventListener("scroll", update, { passive: true });
    // 画面の回転や文字の読み込みで幅が変わったときも測り直す
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="relative min-w-0">
      <div ref={ref} className={className}>
        {children}
      </div>
      {hasMore && (
        // 背景（#0a0a0a）へ溶けるグラデーション。押せる範囲を邪魔しないよう pointer-events-none
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-[#0a0a0a] to-transparent sm:hidden"
        />
      )}
    </div>
  );
}
