// 手元のスクリプト（links:* など）が使う DB の窓口。
// スクリプトは Worker の外で動くので、D1 にはバインディングではなく HTTP API でつなぐ（lib/d1.mjs）
import { createD1HttpClient } from "../lib/d1.mjs";

export function getScriptDb() {
  return createD1HttpClient();
}
