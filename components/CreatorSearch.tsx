"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PlatformIcon } from "@/components/PlatformIcons";
import { isPlatformId } from "@/lib/platforms";

type Suggestion = { n: string; l: string | null; h: string; p: string[] };

/** 比べるために文字をそろえる。全角英数→半角、大文字→小文字、カタカナ→ひらがな
 *  （「ぺこら」でも「ペコラ」でも見つかるように） */
function fold(s: string) {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** 配信者の検索欄。打つと候補が出て（予測検索）、Enter で今までどおりの検索結果のページへ。
 *  候補はサーバーに毎回聞かず、最初に検索欄を触ったときに一覧（/creators/suggest）を1回だけ読み、
 *  ブラウザの中で絞り込む。打つたびにサーバーへ問い合わせると、1文字ごとに DB を2万行以上読むことになるため */
export function CreatorSearch({ defaultValue }: { defaultValue: string }) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue);
  const [list, setList] = useState<Suggestion[] | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1); // キーボードで選んでいる候補（-1 は選んでいない）
  const loading = useRef(false);

  // 一覧は最初に触ったときに1回だけ読む（検索しない人には送らない）
  const load = () => {
    if (list || loading.current) return;
    loading.current = true;
    fetch("/creators/suggest")
      .then((r) => r.json())
      .then((json: Suggestion[]) => setList(json))
      .catch(() => setList([]));
  };

  const q = fold(value.trim());
  const matches =
    q.length === 0 || !list
      ? []
      : list
          .filter(
            (s) => fold(s.n).includes(q) || (s.l && fold(s.l).includes(q)),
          )
          // 先頭が一致するものを上に。それ以外は一覧の順（最高同接の大きい順）のまま
          .sort(
            (a, b) =>
              Number(!fold(a.n).startsWith(q)) -
              Number(!fold(b.n).startsWith(q)),
          )
          .slice(0, 8);
  const show = open && matches.length > 0;

  return (
    <form
      action="/creators"
      className="relative mt-6 flex gap-2"
      onSubmit={(e) => {
        // 候補を矢印キーで選んでいるときの Enter は、その人のページへ直接行く
        if (show && active >= 0) {
          e.preventDefault();
          router.push(matches[active].h);
        }
      }}
    >
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
        // 候補を押す前に閉じないよう、少し待ってから閉じる
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % matches.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i <= 0 ? matches.length - 1 : i - 1));
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        autoComplete="off"
        role="combobox"
        aria-expanded={show}
        aria-controls="creator-suggest"
        placeholder="配信者の名前で探す"
        aria-label="配信者の名前で探す"
        className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-gray-100 placeholder:text-gray-500 focus:border-purple-400 focus:outline-none"
      />
      <button
        type="submit"
        className="shrink-0 rounded-lg border border-white/10 px-4 text-sm text-gray-300 transition hover:border-purple-400 hover:text-purple-300"
      >
        検索
      </button>

      {show && (
        <ul
          id="creator-suggest"
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-white/10 bg-[#141414] py-1 shadow-lg sm:right-auto sm:w-[28rem]"
        >
          {matches.map((s, i) => (
            <li key={s.h} role="option" aria-selected={i === active}>
              {/* onMouseDown にするのは、入力欄の onBlur で候補が消える前に押せるようにするため */}
              <a
                href={s.h}
                onMouseDown={(e) => {
                  e.preventDefault();
                  router.push(s.h);
                }}
                className={`flex items-center gap-2 px-4 py-2 text-sm ${
                  i === active
                    ? "bg-white/10 text-purple-300"
                    : "text-gray-200 hover:text-purple-300"
                }`}
              >
                <span className="truncate">{s.n}</span>
                <span className="flex shrink-0 gap-1 text-gray-500">
                  {s.p.filter(isPlatformId).map((p) => (
                    <PlatformIcon key={p} platform={p} />
                  ))}
                </span>
              </a>
            </li>
          ))}
          <li className="border-t border-white/5 px-4 pt-1.5 pb-1 text-[11px] text-gray-500">
            Enter ですべての検索結果を見る
          </li>
        </ul>
      )}
    </form>
  );
}
