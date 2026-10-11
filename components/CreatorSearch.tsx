"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PlatformIcon } from "@/components/PlatformIcons";
import { isPlatformId } from "@/lib/platforms";

type Suggestion = { n: string; l: string | null; h: string; p: string[] };

/** プルダウンに並べる1行。打っている間は予測、空のときは最近の検索 */
type Item =
  | { kind: "suggest"; s: Suggestion }
  | { kind: "recent"; text: string };

const RECENT_KEY = "creator-search-recent";
const RECENT_MAX = 8;

/** 最近の検索はその人のブラウザの中にだけ残す（サーバーには送らない）。
 *  プライベートブラウズなどで読み書きできないこともあるので、失敗しても検索欄は普通に動くようにする */
function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function writeRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // 保存できなくても検索そのものは続ける
  }
}

/** 比べるために文字をそろえる。全角英数→半角、大文字→小文字、カタカナ→ひらがな
 *  （「ぺこら」でも「ペコラ」でも見つかるように） */
function fold(s: string) {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** 配信者の検索欄。Google の検索欄と同じく、入力欄の真下にプルダウンを出す。
 *  - 空のとき：最近の検索（× で1件ずつ消せる）
 *  - 打っている間：予測（押すとその人のページへ）
 *  - Enter：今までどおりの検索結果のページへ
 *  予測はサーバーに毎回聞かず、最初に検索欄を触ったときに一覧（/creators/suggest）を1回だけ読み、
 *  ブラウザの中で絞り込む。打つたびにサーバーへ問い合わせると、1文字ごとに DB を2万行以上読むことになるため */
export function CreatorSearch({ defaultValue }: { defaultValue: string }) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue);
  const [list, setList] = useState<Suggestion[] | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1); // キーボードで選んでいる行（-1 は選んでいない）
  const loading = useRef(false);

  // 一覧は最初に触ったときに1回だけ読む（検索しない人には送らない）
  const load = () => {
    setRecent(readRecent());
    if (list || loading.current) return;
    loading.current = true;
    fetch("/creators/suggest")
      .then((r) => r.json())
      .then((json: Suggestion[]) => setList(json))
      .catch(() => setList([]));
  };

  /** 検索した言葉を最近の検索の先頭に足す（同じ言葉は1つにまとめる） */
  const remember = (text: string) => {
    const t = text.trim();
    if (!t) return;
    const next = [t, ...readRecent().filter((x) => x !== t)].slice(
      0,
      RECENT_MAX,
    );
    writeRecent(next);
    setRecent(next);
  };
  const forget = (text: string) => {
    const next = readRecent().filter((x) => x !== text);
    writeRecent(next);
    setRecent(next);
  };
  const searchFor = (text: string) => {
    remember(text);
    router.push(`/creators?q=${encodeURIComponent(text)}`);
  };

  const q = fold(value.trim());
  const items: Item[] =
    q.length === 0
      ? recent.map((text) => ({ kind: "recent" as const, text }))
      : (list ?? [])
          .filter(
            (s) => fold(s.n).includes(q) || (s.l && fold(s.l).includes(q)),
          )
          // 先頭が一致するものを上に。それ以外は一覧の順（最高同接の大きい順）のまま
          .sort(
            (a, b) =>
              Number(!fold(a.n).startsWith(q)) -
              Number(!fold(b.n).startsWith(q)),
          )
          .slice(0, 8)
          .map((s) => ({ kind: "suggest" as const, s }));
  const show = open && items.length > 0;

  /** 行を選んだとき（クリックか、矢印で選んで Enter） */
  const choose = (item: Item) => {
    setOpen(false);
    if (item.kind === "recent") {
      setValue(item.text);
      searchFor(item.text);
    } else {
      router.push(item.s.h);
    }
  };

  return (
    <form
      action="/creators"
      className="mt-6 flex items-start gap-2"
      onSubmit={(e) => {
        // 矢印キーで行を選んでいるときの Enter は、その行を選んだことにする
        if (show && active >= 0) {
          e.preventDefault();
          choose(items[active]);
          return;
        }
        // 普通の Enter・検索ボタンは、今までどおりフォームを送る（検索結果のページへ）。その前に履歴に残す
        remember(value);
      }}
    >
      {/* 入力欄とプルダウンを1つの枠に入れ、プルダウンを入力欄の真下に同じ幅で出す（Google の検索欄と同じ形） */}
      <div className="relative min-w-0 flex-1">
        <input
          type="search"
          name="q"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => {
            load();
            setOpen(true);
          }}
          // 行を押す前に閉じないよう、少し待ってから閉じる
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!show) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => (i + 1) % items.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          // ブラウザが覚えている入力の履歴（吹き出し）は出さない。履歴はこの部品のプルダウンに出す
          autoComplete="off"
          role="combobox"
          aria-expanded={show}
          aria-controls="creator-suggest"
          placeholder="配信者の名前で探す"
          aria-label="配信者の名前で探す"
          // プルダウンが開いている間は下の角を四角にして、1枚につながって見えるようにする。
          // スマホは文字を16px（text-base）にする。iPhone の Safari は16px 未満の入力欄を押すと画面を拡大し、
          // 検索した後も拡大が残って横にずれていた（2026-10-11）。拡大の禁止はせず（自分で拡大したい人が困るため）、文字の大きさで防ぐ
          className={`w-full border bg-white/5 px-4 py-2.5 text-base text-gray-100 sm:text-sm placeholder:text-gray-500 focus:border-purple-400 focus:outline-none ${
            show
              ? "rounded-t-lg border-purple-400 bg-[#141414]"
              : "rounded-lg border-white/10"
          }`}
        />
        {show && (
          <ul
            id="creator-suggest"
            role="listbox"
            className="absolute left-0 right-0 top-full z-30 overflow-hidden rounded-b-lg border border-t-0 border-purple-400 bg-[#141414] pb-1 shadow-lg"
          >
            <li aria-hidden className="mx-4 mb-1 border-t border-white/10" />
            {items.map((item, i) => {
              const rowClass = `flex min-w-0 flex-1 items-center gap-2 px-4 py-2 text-left text-sm ${
                i === active
                  ? "bg-white/10 text-purple-300"
                  : "text-gray-200 hover:text-purple-300"
              }`;
              return (
                <li
                  key={item.kind === "recent" ? `r-${item.text}` : item.s.h}
                  role="option"
                  aria-selected={i === active}
                  className="flex items-center"
                >
                  {/* onMouseDown にするのは、入力欄の onBlur でプルダウンが消える前に押せるようにするため */}
                  {item.kind === "recent" ? (
                    <>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          choose(item);
                        }}
                        className={rowClass}
                      >
                        <ClockIcon />
                        <span className="truncate">{item.text}</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`「${item.text}」を履歴から消す`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          forget(item.text);
                        }}
                        className="shrink-0 px-4 py-2 text-xs text-gray-500 hover:text-purple-300"
                      >
                        ×
                      </button>
                    </>
                  ) : (
                    <a
                      href={item.s.h}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        choose(item);
                      }}
                      className={rowClass}
                    >
                      <SearchIcon />
                      <span className="truncate">{item.s.n}</span>
                      <span className="flex shrink-0 gap-1 text-gray-500">
                        {item.s.p.filter(isPlatformId).map((p) => (
                          <PlatformIcon key={p} platform={p} />
                        ))}
                      </span>
                    </a>
                  )}
                </li>
              );
            })}
            {q.length > 0 && (
              <li className="border-t border-white/5 px-4 pb-1 pt-1.5 text-[11px] text-gray-500">
                Enter ですべての検索結果を見る
              </li>
            )}
          </ul>
        )}
      </div>
      <button
        type="submit"
        className="shrink-0 rounded-lg border border-white/10 px-4 py-2.5 text-sm text-gray-300 transition hover:border-purple-400 hover:text-purple-300"
      >
        検索
      </button>
    </form>
  );
}

/** 行の頭の小さな印（Google と同じく、履歴は時計・予測は虫めがね） */
const iconProps = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  className: "shrink-0 text-gray-500",
  "aria-hidden": true,
};
function ClockIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
