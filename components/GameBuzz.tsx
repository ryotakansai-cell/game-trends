import Image from "next/image";
import Link from "next/link";
import type { BuzzItem } from "@/lib/game-buzz";

/** ゲームの「総合」ページの一番上に出す「いま話題のゲーム」。
 *  ランキングだけ見たい人の邪魔にならないよう、高さは1列ぶんに抑える。
 *  スマホは横に送る帯（縦は画面の4分の1ほど）、PC は5枚を横に並べる。
 *  話題が無いときは呼び出し側で枠ごと出さない */
export function GameBuzz({ items }: { items: BuzzItem[] }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold text-white">
        いま話題のゲーム
        {/* スマホでは見出しの下の行に（見出しの横だと中途半端な所で折り返すため） */}
        <span className="mt-0.5 block text-xs font-normal text-gray-500 sm:ml-2 sm:mt-0 sm:inline">
          24時間前と比べて大きく動いたもの ・ 毎時更新
        </span>
      </h2>
      {/* スマホ：横に送る帯（-mx-6 px-6 で画面の端まで送れるようにする）。sm 以上：5列に並べる。
          scroll-px-6 が無いと、送ったときに止まる位置が余白を無視して画面の左端にくっつく */}
      <ul className="-mx-6 mt-3 flex snap-x scroll-px-6 gap-3 overflow-x-auto px-6 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-5 sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
        {items.map((item) => (
          <li key={item.key} className="w-36 shrink-0 snap-start sm:w-auto">
            <Card item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Card({ item }: { item: BuzzItem }) {
  const body = (
    <>
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-white/10 bg-white/5 transition group-hover:border-purple-400/50">
        {item.imageUrl && (
          <Image
            src={item.imageUrl}
            alt={item.name}
            fill
            className={
              item.imageFit === "cover" ? "object-cover" : "object-contain"
            }
            unoptimized
          />
        )}
        {/* 伸びたものは急上昇ページと同じ緑。初めて入ったものは琥珀色で見分ける（紫は現在地と hover だけに使う決まり） */}
        <span
          className={`absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold sm:text-xs ${
            item.kind === "surge"
              ? "bg-green-600/90 text-white"
              : "bg-amber-400/90 text-black"
          }`}
        >
          {item.label}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-sm font-bold text-gray-100 group-hover:text-purple-300">
        {item.name}
      </p>
      <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{item.reason}</p>
    </>
  );
  if (item.external)
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        className="group block"
      >
        {body}
      </a>
    );
  return (
    <Link href={item.href} className="group block">
      {body}
    </Link>
  );
}
