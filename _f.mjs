import fs from "node:fs";
const p = "scripts/links-review.mjs";
let s = fs.readFileSync(p, "utf8");
const from = `  const subscribers = ch?.subscribers ?? null;
  const haystack = \`\${title}\n\${description.slice(0, 400)}\`;
`;
const to = `  const subscribers = ch?.subscribers ?? null;
`;
if (!s.includes(from)) { console.error("見つかりません"); process.exit(1); }
fs.writeFileSync(p, s.replace(from, to));
console.log("未使用の変数を削除");
