// サイトのアイコンを、元の絵（design/icon.svg。再生ボタンの中に伸びる折れ線）から作る。
// npm run make:icons
//
// 作るもの（Next.js はこの名前のファイルを app/ に置くと、自動で <link rel="icon"> などを出す）
//   app/icon.svg        今のブラウザ用。拡大しても崩れない
//   app/favicon.ico     古いブラウザや検索結果用。16・32・48px を1つにまとめる
//   app/apple-icon.png  iPhone のホーム画面用（180px）
//
// 縮小には sharp を使う。Next.js が画像の最適化に使っていて node_modules に入っているので、別に入れていない
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const svg = await readFile("design/icon.svg");

const png = (size) => sharp(svg, { density: 300 }).resize(size, size).png().toBuffer();

await writeFile("app/icon.svg", svg);
await writeFile("app/apple-icon.png", await png(180));

// ICO は「目次 + 画像」の単純な形式。中身に PNG をそのまま入れられる（Windows Vista 以降・主要ブラウザが対応）
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(png));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // 予約
header.writeUInt16LE(1, 2); // 1 = アイコン
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((size, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(size, 0); // 幅
  e.writeUInt8(size, 1); // 高さ
  e.writeUInt8(0, 2); // パレットの色数（PNG なので 0）
  e.writeUInt8(0, 3); // 予約
  e.writeUInt16LE(1, 4); // 色面
  e.writeUInt16LE(32, 6); // 1画素のビット数
  e.writeUInt32LE(images[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += images[i].length;
  return e;
});
await writeFile("app/favicon.ico", Buffer.concat([header, ...entries, ...images]));

console.log("app/icon.svg, app/apple-icon.png, app/favicon.ico を作りました");
