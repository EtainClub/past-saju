import { NextResponse, type NextRequest } from "next/server";
import { corsHeaders, preflight } from "@/lib/cors";

/**
 * API 교차 출처 처리.
 *
 * 토스 앱은 정적 번들을 열기 때문에 출처가 웹과 다르다. 서버가 허용하지
 * 않으면 브라우저가 응답을 버린다.
 *
 * 라우트 5개를 각각 고치지 않고 여기 한 곳에서 붙인다 — 라우트가 늘어날 때
 * CORS 를 빠뜨리는 실수를 구조적으로 막는다.
 *
 * 허용 판단은 `lib/cors.ts` 가 한다. 목록에 없는 출처에는 헤더를 안 붙이고,
 * 그러면 브라우저가 알아서 막는다.
 */
export function proxy(request: NextRequest) {
  // 사전 요청은 라우트까지 갈 필요가 없다. 여기서 끝낸다.
  if (request.method === "OPTIONS") return preflight(request);

  const response = NextResponse.next();
  for (const [key, value] of Object.entries(corsHeaders(request))) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  // API 에만 적용한다. 화면 라우트는 교차 출처로 부를 일이 없다.
  matcher: "/api/:path*",
};
