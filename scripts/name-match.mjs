// 名前を比べるための道具（links:review と links:twitcasting で共用）

/** 比較用に名前をそろえる。記号・敬称・「チャンネル」などの飾りを落とす */
export function normalize(s) {
  return (
    String(s ?? "")
      .toLowerCase()
      // 全角の英数字を半角にする（ＡＢＣ → abc）
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
        String.fromCharCode(c.charCodeAt(0) - 0xfee0),
      )
      // 記号と空白をすべて取り除く
      .replace(/[【】\[\]（）()｜|・,、。.\-_/\!！?？:：'"’”~〜\s]/g, "")
      // 敬称やチャンネルを表す語は名前の一部ではないので落とす
      .replace(/(さん|ちゃん|channel|チャンネル|ゲーム実況|公式|official)/g, "")
  );
}

/** 2文字ずつの組（バイグラム）に分ける */
export function bigrams(s) {
  const out = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/** 2つの名前の似ている度合いを 0〜1 で返す（ダイス係数）。
 *  「共通する2文字組がどれだけ多いか」で測る素朴な方法 */
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.length === 0 || B.length === 0) return 0;
  const pool = [...B];
  let hit = 0;
  for (const g of A) {
    const i = pool.indexOf(g);
    if (i >= 0) {
      hit++;
      pool.splice(i, 1); // 同じ組を二重に数えない
    }
  }
  return (2 * hit) / (A.length + B.length);
}
