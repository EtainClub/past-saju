import { defineConfig } from "@apps-in-toss/web-framework/config";

// ⚠ 파일명이 apps-in-toss.config.ts 여야 한다. v2 의 granite.config 는 v3 에서
//    마이그레이션 명령만 읽는다 — 그 이름으로 두면 CLI 가 설정을 못 찾고
//    "appName must not be empty" 로 죽는다.

/**
 * 앱인토스(Apps in Toss) 설정 — web-framework v3.
 *
 * 기존 웹 배포(Firebase App Hosting)는 그대로 두고 토스 전용 명령만 따로 쓴다.
 *   pnpm build:ait   TOSS_BUILD=1 로 정적 내보내기 → .ait 번들 생성
 *   pnpm deploy:ait  콘솔 업로드 (CLI 인증 필요)
 *
 * **구조** — 토스 빌드는 화면만 정적으로 내보내고, API 는 이미 배포된
 * ifsaju.com 을 호출한다. LLM 키와 Firestore 자격증명은 서버에만 있어야 하므로
 * 앱이 직접 모델을 부르는 구조는 애초에 불가능하고, 서버를 한 벌 더 두지도 않는다.
 *
 * ⚠ keycap-creator 는 v2 를 쓴다. v3 는 스키마가 다르다 —
 *    v2 의 `web.commands` / `outdir` / `webViewProps` / `brand.displayName` 이
 *    각각 사라지거나 `webBundleDir` / `webView` 로 바뀌었다. 빌드는 CLI 가
 *    실행하지 않으므로 **먼저 정적 내보내기를 하고** ait build 를 부른다.
 *
 * ⚠ appName 은 **앱인토스 콘솔에 등록한 값과 반드시 같아야** 한다.
 *    다르면 업로드가 거부된다.
 */
export default defineConfig({
  appName: "ifsaju",
  brand: {
    primaryColor: "#7A1D2F",
  },
  webView: {
    // 카드 공개 연출이 있어 위아래로 튕기면 흐름이 끊긴다.
    bounces: false,
    // 결과를 읽는 도중 당겨서 새로고침되면 세션이 날아간 것처럼 보인다.
    pullToRefreshEnabled: false,
  },
  // 카메라·마이크·위치를 쓰지 않는다. 필요 없는 권한은 선언하지 않는다 —
  // 심사에서 사유를 대야 하고 사용자에게도 불필요한 요구가 된다.
  permissions: [],
  // next.config.ts 의 정적 내보내기 산출 위치.
  webBundleDir: "out",
});
