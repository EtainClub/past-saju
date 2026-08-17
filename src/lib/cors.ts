/**
 * 교차 출처 허용 — 토스 앱(WebView)이 배포된 API 를 부를 수 있게 한다.
 *
 * 토스 앱은 정적 번들을 열기 때문에 출처가 웹과 다르다. 서버가 허용하지
 * 않으면 브라우저가 응답을 버린다.
 *
 * **와일드카드를 쓰지 않는다.** `Authorization` 과 App Check 토큰을 싣는
 * 요청이라 아무 출처에나 열어 주면 안 된다. 허용 목록에 있는 출처에만
 * 그 출처를 그대로 돌려준다.
 *
 * WebView 의 실제 Origin 은 플랫폼·버전에 따라 다르다. 값이 정해지면
 * TOSS_ALLOWED_ORIGINS 에 콤마로 넣는다 — 코드 배포 없이 바꿀 수 있어야 한다.
 */

const DEFAULT_ALLOWED = [
  "https://ifsaju.com",
  "https://www.ifsaju.com",
  "https://past-saju--pastsaju.asia-east1.hosted.app",
];

function allowedOrigins() {
  const extra = (process.env.TOSS_ALLOWED_ORIGINS ?? "")
    .split(",").map((item) => item.trim()).filter(Boolean);
  return [...DEFAULT_ALLOWED, ...extra];
}

/**
 * 요청 Origin 이 허용 목록에 있으면 CORS 헤더를 만든다.
 *
 * 없으면 **빈 객체**를 돌려준다 — 헤더를 안 붙이면 브라우저가 알아서 막는다.
 * 서버가 굳이 거절 응답을 만들 필요가 없다.
 */
export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins().includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    // 출처마다 응답이 다르므로 캐시가 섞이지 않게 한다.
    Vary: "Origin",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Firebase-AppCheck",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

/** 사전 요청(preflight) 응답. 본문 없이 헤더만 낸다. */
export function preflight(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

/** 이미 만든 응답에 CORS 헤더를 얹는다. */
export function withCors(response: Response, request: Request) {
  const headers = corsHeaders(request);
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}
