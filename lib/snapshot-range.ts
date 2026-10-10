// live_snapshots を「24時間前の前後◯時間」だけに絞るための範囲を作る。
//
// 急上昇の SQL は、以前は全履歴（10万行以上。毎時約2万行ずつ増える）を毎回読んでいた。
// 使うのは最新の1回分と24時間前付近だけなので、captured_at の索引で範囲を絞る。
// 2026-10 の実測で、急上昇（Twitch）が 10.9秒 → 0.09秒、結果は同じ。
// Turso は読んだ行数で無料枠（月5億行）を数えるので、速さだけでなく枠の節約にもなる。
//
// captured_at は toISOString() の形（2026-10-07T12:23:00.000Z）で保存しているので、
// 同じ形の文字列どうしなら BETWEEN の文字列比較で時刻の範囲になる
/** 日本時間の日付（2026-10-10）を返す。集計や「何日見つかったか」は日本の1日で区切る。
 *  UTC のまま日付を切ると、日本の朝9時で日が変わってしまうため */
export function jstDay(date = new Date()): string {
  return new Date(date.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function pastWindow(hours: number): [string, string] {
  const center = Date.now() - 24 * 3600 * 1000;
  return [
    new Date(center - hours * 3600 * 1000).toISOString(),
    new Date(center + hours * 3600 * 1000).toISOString(),
  ];
}
