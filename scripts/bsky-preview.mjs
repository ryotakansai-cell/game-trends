// Bluesky に投稿する文面とカードの画像を、投稿せずに確かめる。
// 使い方: npm run bsky:preview                        … 本番（stream-trends.sukinote.com）の今の中身
//         npm run bsky:preview -- http://localhost:8787 … 手元（npm run preview）の中身
//
// 投稿は決まった時刻にしか流れないので、形を変えたときに何時間も待たずに確かめるために作った（2026-10-17）。
// /api/cron/bluesky の dryRun（投稿もログインの確認以外もしない）を呼び、文面を表示して、
// カードの画像を .bsky-preview/ に保存する（Git には入れない）。
// スマホの Bluesky 上での折り返しまでは再現できない（画面の幅と文字の大きさで変わるため）
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.argv[2] ?? "https://stream-trends.sukinote.com";
const headers = { Authorization: `Bearer ${process.env.CRON_SECRET}` };
const OUT = ".bsky-preview";
mkdirSync(OUT, { recursive: true });

const graphemes = (s) =>
  [...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(s)].length;

/** 画像を取ってきて保存する。失敗したら理由を表示する */
async function saveImage(url, file, auth) {
  const res = await fetch(url, auth ? { headers } : undefined);
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("image/")) {
    console.log(`  画像を取れませんでした（${res.status} ${type}）`);
    return;
  }
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log(`  画像: ${file}`);
}

for (const kind of ["live", "daily"]) {
  const res = await fetch(`${base}/api/cron/bluesky?kind=${kind}&dryRun=1`, {
    headers,
  });
  const report = await res.json();
  const title =
    kind === "live"
      ? "いま見られている配信（12・18・21時）"
      : "前日のまとめ（朝8時）";
  console.log(`\n===== ${title}`);
  if (!res.ok || !report.text) {
    console.log(report);
    continue;
  }
  console.log(report.text);
  console.log(
    `----- ${graphemes(report.text)} 文字（上限300）` +
      (report.skipped ? ` ／ ${report.skipped}（この回は投稿済みなど）` : "") +
      (report.login ? ` ／ ログイン: ${report.login}` : ""),
  );
  if (kind === "live") {
    await saveImage(
      `${base}/api/cron/bluesky?kind=live&dryRun=1&image=1`,
      `${OUT}/live.png`,
      true,
    );
  } else if (report.key) {
    // 朝のまとめのカードは、その日の日付ページの OGP 画像
    await saveImage(
      `${base}/daily/${report.key}/opengraph-image`,
      `${OUT}/daily.png`,
      false,
    );
  }
}
