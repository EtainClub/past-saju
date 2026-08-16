"use client";

import { getApps, initializeApp } from "firebase/app";
import { ReCaptchaEnterpriseProvider, getToken, initializeAppCheck, type AppCheck } from "firebase/app-check";

/**
 * App Check 클라이언트.
 *
 * 필요한 값이 하나라도 없으면 조용히 비활성화된다. 서버가 monitor 모드면 그대로
 * 통과하고, enforce 모드면 401이 나므로 **환경변수 누락이 곧바로 드러난다.**
 *
 * 필요한 값:
 *   NEXT_PUBLIC_FIREBASE_API_KEY
 *   NEXT_PUBLIC_FIREBASE_APP_ID
 *   NEXT_PUBLIC_FIREBASE_PROJECT_ID
 *   NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY  (reCAPTCHA Enterprise 사이트 키)
 */

let instance: AppCheck | null | undefined;

function ensureAppCheck() {
  if (instance !== undefined) return instance;
  if (typeof window === "undefined") return (instance = null);

  const siteKey = process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY;
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!siteKey || !apiKey || !appId || !projectId) return (instance = null);

  try {
    const app = getApps()[0] ?? initializeApp({ apiKey, appId, projectId });
    instance = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (error) {
    console.error("App Check 초기화 실패", error);
    instance = null;
  }
  return instance;
}

/** API 호출에 붙일 헤더. 토큰을 못 얻으면 빈 객체를 돌려준다. */
export async function appCheckHeaders(): Promise<Record<string, string>> {
  const appCheck = ensureAppCheck();
  if (!appCheck) return {};
  try {
    const { token } = await getToken(appCheck);
    return { "X-Firebase-AppCheck": token };
  } catch (error) {
    console.error("App Check 토큰 발급 실패", error);
    return {};
  }
}

/** 페이지 진입 시 미리 토큰을 받아 두면 첫 요청의 지연이 줄어든다. */
export function warmAppCheck() {
  void appCheckHeaders();
}
