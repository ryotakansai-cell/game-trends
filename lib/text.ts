// 文字列を短く見せるための部品（Bluesky の投稿・OGP 画像・ページで共用）。
// 文字数は書記素（見た目の1文字）で数える。絵文字や結合文字を途中で切ると文字化けするため

function* segment(s: string) {
  for (const { segment } of new Intl.Segmenter("ja", {
    granularity: "grapheme",
  }).segment(s)) {
    yield segment;
  }
}

/** 見た目の文字数 */
export const graphemes = (s: string) => [...segment(s)].length;

/** n 文字（書記素）を超えたら n-1 文字で切って … を付ける */
export const clip = (s: string, n: number) =>
  graphemes(s) > n ? [...segment(s)].slice(0, n - 1).join("") + "…" : s;

// 配信タイトルの「中身ではない部分」。2026-10-16 の日本の上位40配信のタイトルを見て決めた。
// ハッシュタグは、文の途中のもの（#ホロドリ釣り名人 緊急参戦）は中身なので「#」だけ外し、
// 末尾に並ぶもの（… 2026 #ChampsCostream）は飾りなので消す
const TRAILING_HASHTAGS = /(\s+[#＃][^\s#＃]+)+\s*$/;
const HASH_MARK = /[#＃](?=[^\s#＃])/g;
const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0F}\u{200D}]/gu; // ⚾️✨🇨🇳‼️
// 括弧の中が日時だけ（【10/16(金)18:00〜】）。何時からの配信かは一覧では要らない
const DATE_BRACKET = /【[^【】]*\d{1,2}[/:：月]\d{1,2}[^【】]*】/g;
// 末尾の括弧（【ホロライブ/兎田ぺこら】【からあげ】）。出演者やグループ名を書く慣習で、名前は別に出しているため
const TRAILING_BRACKET = /\s*[【[][^【】[\]]*[】\]]\s*$/;

/** 配信タイトルを一覧向けに縮める。
 *  ハッシュタグ・絵文字・日時だけの括弧・末尾の出演者の括弧を外してから、max 文字で切る。
 *  先頭の【スプラトゥーン3】のような括弧はゲーム名など中身を表すことが多いので残す */
export function shortTitle(title: string, max: number): string {
  let t = title
    .replace(TRAILING_HASHTAGS, "")
    .replace(HASH_MARK, "")
    .replace(EMOJI, "")
    .replace(/(.)\1{2,}/gu, "$1$1") // ！！！！！！ → ！！（同じ文字の繰り返しで文字数を使わない）
    .replace(DATE_BRACKET, "")
    .replace(/【\s*】|\[\s*\]/g, "") // 中身を外して空になった括弧
    .replace(/【\s+/g, "【")
    .replace(/\s+】/g, "】")
    .replace(/\s+/g, " ")
    .trim();
  // 末尾の括弧は、外しても中身が4文字以上残るときだけ外す（括弧しか無いタイトルを空にしない）
  for (;;) {
    const next = t.replace(TRAILING_BRACKET, "").trim();
    if (next === t || graphemes(next) < 4) break;
    t = next;
  }
  return clip(t || title.trim(), max);
}
