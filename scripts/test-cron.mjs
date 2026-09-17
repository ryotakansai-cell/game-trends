// ローカルのcronエンドポイントを叩くだけのテスト用スクリプト
// 使い方: npm run test:cron -- youtube-snapshot
const path = process.argv[2];
if (!path) {
  console.error("使い方: npm run test:cron -- <エンドポイント名>（例: youtube-snapshot）");
  process.exit(1);
}

const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET が読み込めませんでした。.env.local を確認してください。");
  process.exit(1);
}

const url = `http://localhost:3000/api/cron/${path}`;

const res = await fetch(url, {
  headers: { Authorization: `Bearer ${secret}` },
});
const json = await res.json();

console.log(`status: ${res.status}`);
console.log(JSON.stringify(json, null, 2));
