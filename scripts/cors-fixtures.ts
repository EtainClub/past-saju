import { strict as assert } from "node:assert";

/**
 * 교차 출처 허용 목록 검증.
 *
 * 이 목록이 느슨해지면 **Authorization 과 App Check 토큰을 싣는 요청이
 * 아무 사이트에나 열린다.** 와일드카드가 아니라는 것, 목록에 없는 출처에는
 * 헤더가 한 줄도 안 붙는다는 것이 여기서 보장된다.
 *
 * 미허용 출처 기록은 토스 WebView 의 Origin 을 알아내는 유일한 통로다.
 * 그게 실제로 남는지, 그리고 로그를 잠기게 하지는 않는지도 함께 본다.
 */

// 허용 목록은 요청마다 환경변수를 다시 읽는다. 그래도 import 전에 넣어 둔다.
process.env.TOSS_ALLOWED_ORIGINS = "https://webview.example";

import { corsHeaders, preflight } from "../src/lib/cors";

function req(origin: string | null, method = "POST") {
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  return new Request("https://ifsaju.com/api/chart", { method, headers });
}

// ── 1. 허용 출처 — 받은 출처를 그대로 돌려준다 ────────────────────────
for (const origin of ["https://ifsaju.com", "https://www.ifsaju.com"]) {
  const headers = corsHeaders(req(origin));
  assert.equal(headers["Access-Control-Allow-Origin"], origin, `${origin} 허용 실패`);
  // 출처마다 응답이 다르므로 Vary 가 없으면 캐시가 섞인다.
  assert.equal(headers.Vary, "Origin", `${origin} Vary 누락`);
}

// ── 2. 환경변수로 넣은 출처도 허용된다 ────────────────────────────────
// 코드 배포 없이 WebView Origin 을 넣을 수 있어야 한다는 게 설계 전제다.
assert.equal(
  corsHeaders(req("https://webview.example"))["Access-Control-Allow-Origin"],
  "https://webview.example",
  "TOSS_ALLOWED_ORIGINS 가 반영되지 않았다",
);

// ── 3. 미허용 출처 — 헤더가 하나도 안 붙는다 ──────────────────────────
const REJECTED = [
  "https://evil.example",
  "null",
  "https://ifsaju.com.evil.example", // 접두사만 같은 사칭
  "http://ifsaju.com", // 평문 http 는 다른 출처다
];
for (const origin of REJECTED) {
  assert.deepEqual(corsHeaders(req(origin)), {}, `${origin} 가 거절되지 않았다`);
}

// ── 4. 와일드카드를 쓰지 않는다 ───────────────────────────────────────
for (const origin of ["https://ifsaju.com", ...REJECTED]) {
  assert.notEqual(corsHeaders(req(origin))["Access-Control-Allow-Origin"], "*", "와일드카드가 나왔다");
}

// ── 5. Origin 없는 요청 — 조용히 넘긴다 ───────────────────────────────
// 서버 대 서버 호출이거나 같은 출처 요청이다. 기록할 값도 없다.
assert.deepEqual(corsHeaders(req(null)), {}, "Origin 없는 요청에 헤더가 붙었다");

// ── 6. 사전 요청 ──────────────────────────────────────────────────────
const allowed = preflight(req("https://ifsaju.com", "OPTIONS"));
assert.equal(allowed.status, 204, "사전 요청 상태 코드가 다르다");
assert.equal(allowed.headers.get("access-control-allow-origin"), "https://ifsaju.com");
// App Check 토큰 헤더가 빠지면 토스 앱의 요청이 사전 단계에서 막힌다.
assert.match(allowed.headers.get("access-control-allow-headers") ?? "", /X-Firebase-AppCheck/);

const denied = preflight(req("https://evil.example", "OPTIONS"));
assert.equal(denied.headers.get("access-control-allow-origin"), null, "미허용 출처에 사전 응답이 열렸다");

// ── 7. 미허용 출처 기록 — 남되, 한 번만 남는다 ────────────────────────
// WebView 는 요청마다 같은 출처를 보낸다. 매번 찍으면 로그가 잠겨서
// 정작 찾으려던 값을 못 찾는다.
const realWarn = console.warn;
const warned: string[] = [];
console.warn = (...args: unknown[]) => void warned.push(String(args[0]));
try {
  for (let i = 0; i < 5; i += 1) corsHeaders(req("https://unseen.example"));
  corsHeaders(req(null));
  corsHeaders(req("https://ifsaju.com"));
} finally {
  console.warn = realWarn;
}
assert.equal(warned.length, 1, `기록이 ${warned.length}건 — 한 번만 남아야 한다`);
assert.match(warned[0], /unseen\.example/, "기록에 출처 값이 없다");
// 값만 알려주고 끝나면 다음에 뭘 해야 할지 모른다.
assert.match(warned[0], /TOSS_ALLOWED_ORIGINS/, "기록이 다음 조치를 안 알려준다");

// ── 8. 로그 위조 내성 ─────────────────────────────────────────────────
// Origin 은 클라이언트가 정하는 값이라 가짜 로그 줄을 심으려 들 수 있다.
// 줄바꿈은 헤더 계층이 이미 막는다 — 여기서 그 전제를 못 박아 둔다.
// 이게 깨지면 cors.ts 의 줄바꿈 제거가 유일한 방어선이 된다.
assert.throws(
  () => req("https://a.example\nCORS 미허용 출처: https://b.example"),
  "줄바꿈이 헤더에 들어갔다 — 로그 위조가 가능해진다",
);

// 길이는 막아 주지 않는다. 한 줄이 무한정 길어지면 로그가 못 쓰게 된다.
const forged: string[] = [];
console.warn = (...args: unknown[]) => void forged.push(String(args[0]));
try {
  corsHeaders(req(`https://${"z".repeat(400)}.example`));
} finally {
  console.warn = realWarn;
}
assert.equal(forged.length, 1, "긴 출처가 기록되지 않았다");
assert.ok(forged[0].length < 200, `기록 길이 ${forged[0].length} — 잘리지 않았다`);

console.log("cors fixtures: 허용목록·환경변수·사칭거절·와일드카드금지·사전요청·기록1회·위조내성 passed");
