/**
 * API 요청 주소.
 *
 * 웹에서는 상대경로면 충분하다. **토스 앱(WebView)은 정적 번들을 열기 때문에
 * 서버가 없다** — 상대경로로 부르면 번들 안에서 찾다가 실패한다. 그래서
 * 토스 빌드에서는 이미 배포된 서버의 절대 주소를 쓴다.
 *
 * 서버를 한 벌 더 두지 않는 선택이다. LLM 키·Firestore 자격증명은 서버에만
 * 있어야 하므로, 앱이 직접 모델을 부르는 구조는 애초에 불가능하다.
 *
 * NEXT_PUBLIC_ 접두사가 필요하다 — 빌드 시점에 번들에 박혀야 한다.
 */
const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN?.replace(/\/+$/, "") ?? "";

/**
 * `/api/...` 를 실제 호출 주소로 바꾼다.
 *
 * 값이 비어 있으면 상대경로 그대로다 — 웹 배포의 기존 동작이 바뀌지 않는다.
 */
export function apiUrl(path: string) {
  return API_ORIGIN ? `${API_ORIGIN}${path}` : path;
}

/** 토스 앱처럼 다른 출처의 서버를 부르는 중인가. */
export function isCrossOrigin() {
  return API_ORIGIN.length > 0;
}
