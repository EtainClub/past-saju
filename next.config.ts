import type { NextConfig } from "next";
import { version } from "./package.json";

/**
 * 앱인토스(Apps in Toss) 빌드는 **정적 내보내기**다.
 *
 * 이 서비스의 API 라우트는 Request 를 읽으므로 정적 내보내기에서 지원되지
 * 않는다(Next 문서 "Unsupported Features"). 그래서 토스 빌드는 화면만 내보내고
 * API 는 **이미 배포된 ifsaju.com 을 호출**한다. 서버를 한 벌 더 두지 않는다.
 *
 * TOSS_BUILD=1 일 때만 켜진다. 평소 배포(App Hosting)는 영향을 받지 않는다.
 */
const isTossBuild = process.env.TOSS_BUILD === "1";

/**
 * 라우트로 인식할 확장자.
 *
 * API 라우트 파일은 `route.api.ts` 다. 평소에는 `api.ts` 를 목록에 넣어
 * 라우트로 잡고, 토스 빌드에서는 빼서 **정적 내보내기 대상에서 제외**한다.
 *
 * 빌드 중에 파일을 옮겼다 되돌리는 방식은 중간에 끊기면 저장소가 깨진다.
 * 이 방법은 소스를 건드리지 않는다.
 */
const PAGE_EXTENSIONS = ["tsx", "ts", "jsx", "js"];

const nextConfig: NextConfig = {
  /**
   * 화면에 띄울 버전. **package.json 이 단일 출처다.**
   *
   * 화면에 쓰려고 상수를 따로 두면 올릴 때 한쪽만 고쳐 어긋난다. 그렇다고
   * 클라이언트에서 package.json 을 통째로 import 하면 스크립트와 주석까지
   * 번들에 실린다. 여기서 값 하나만 꺼내 넘긴다.
   */
  env: { NEXT_PUBLIC_APP_VERSION: version },
  pageExtensions: isTossBuild ? PAGE_EXTENSIONS : ["api.ts", ...PAGE_EXTENSIONS],
  ...(isTossBuild
    ? {
      output: "export" as const,
      // WebView 는 정적 파일을 그대로 연다. 서버가 없으므로 /path → /path/index.html
      // 로 떨어지도록 해야 직접 진입이 깨지지 않는다.
      trailingSlash: true,
      // 정적 내보내기에는 이미지 최적화 서버가 없다.
      images: { unoptimized: true },
    }
    : {}),
};

export default nextConfig;
