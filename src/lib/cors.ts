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
 * 아직 모르는 출처를 프로세스마다 한 번씩만 기록한다.
 *
 * 거절은 조용히 해도 되지만, **값을 모르면 허용 목록에 넣을 수가 없다.**
 * 토스 WebView 의 Origin 이 딱 그렇다 — 실물을 한 번 열어봐야 알 수 있는데,
 * 그때 로그에 안 남으면 "안 된다"만 알고 끝난다.
 *
 * WebView 는 요청마다 같은 출처를 보내므로 매번 찍으면 로그가 잠긴다.
 * 처음 본 값만 남긴다.
 */
const reportedOrigins = new Set<string>();

function reportUnknownOrigin(origin: string) {
  // 헤더는 클라이언트가 정하는 값이다. 줄바꿈으로 로그를 위조하지 못하게 자른다.
  const safe = origin.replace(/[\r\n]/g, " ").slice(0, 120);
  if (reportedOrigins.has(safe)) return;
  // 무작위 출처를 흘려 넣어 메모리를 불리는 걸 막는다. 넘치면 더 안 담을 뿐,
  // 이미 담긴 값의 중복 억제는 계속 동작한다.
  if (reportedOrigins.size >= 50) return;
  reportedOrigins.add(safe);
  console.warn(`CORS 미허용 출처: ${safe} — 토스 WebView 라면 TOSS_ALLOWED_ORIGINS 에 넣는다`);
}

/**
 * 요청 Origin 이 허용 목록에 있으면 CORS 헤더를 만든다.
 *
 * 없으면 **빈 객체**를 돌려준다 — 헤더를 안 붙이면 브라우저가 알아서 막는다.
 * 서버가 굳이 거절 응답을 만들 필요가 없다.
 */
export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin) return {};
  if (!allowedOrigins().includes(origin)) {
    reportUnknownOrigin(origin);
    return {};
  }
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
