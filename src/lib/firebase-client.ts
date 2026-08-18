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

/** App Check 와 Auth 가 같은 FirebaseApp 을 공유해야 한다. */
function ensureApp() {
  if (typeof window === "undefined") return null;
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  if (!apiKey || !appId || !projectId) return null;
  return getApps()[0] ?? initializeApp({ apiKey, appId, projectId, authDomain });
}

let instance: AppCheck | null | undefined;

function ensureAppCheck() {
  if (instance !== undefined) return instance;
  const app = ensureApp();
  const siteKey = process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY;
  if (!app || !siteKey) return (instance = null);

  try {
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

/* ── 인증 ───────────────────────────────────────────────────────────────
 *
 * 접속하면 **익명으로 자동 로그인**한다. 사용자는 이 과정을 인지하지 못하고,
 * 로그인 화면도 없다. 목적은 두 가지다:
 *   1. 통계 — IP 해시로는 "몇 명이 몇 번 썼는지"를 알 수 없다
 *   2. 속도 제한 — 한국 이동통신 NAT 에서는 수천 명이 같은 IP 를 쓴다.
 *      IP 기준 한도는 정상 사용자를 막거나 남용자를 놓치거나 둘 중 하나다
 *
 * 구글 연동은 **결과를 본 뒤 선택**이다. 답변 앞에 벽을 세우면 사용자가
 * 이미 1,400자를 쓴 뒤 매몰비용이 최대인 지점에서 이탈한다. 연동은
 * linkWithPopup 이라 **익명 uid 가 그대로 유지**되어 기존 기록이 안 끊긴다.
 */

type FirebaseAuthModule = typeof import("firebase/auth");

let authModule: FirebaseAuthModule | null | undefined;

async function loadAuth() {
  if (authModule !== undefined) return authModule;
  if (!ensureApp()) return (authModule = null);
  try {
    authModule = await import("firebase/auth");
  } catch (error) {
    console.error("Auth 로드 실패", error);
    authModule = null;
  }
  return authModule;
}

/** 익명 로그인 보장. 이미 로그인돼 있으면 그대로 쓴다. */
export async function ensureAnonymousAuth() {
  const mod = await loadAuth();
  const app = ensureApp();
  if (!mod || !app) return null;
  const auth = mod.getAuth(app);
  if (auth.currentUser) return auth.currentUser;
  try {
    // onAuthStateChanged 로 복원을 한 번 기다린다. 바로 signInAnonymously 를
    // 부르면 새로고침마다 uid 가 새로 생겨 통계가 부풀려진다.
    const restored = await new Promise<import("firebase/auth").User | null>((resolve) => {
      const stop = mod.onAuthStateChanged(auth, (user) => { stop(); resolve(user); });
    });
    if (restored) return restored;
    const credential = await mod.signInAnonymously(auth);
    return credential.user;
  } catch (error) {
    console.error("익명 로그인 실패", error);
    return null;
  }
}

/** 현재 사용자 상태. 저장 버튼 노출 판단에 쓴다. */
export type AuthState = { uid: string; isAnonymous: boolean; name: string | null } | null;

export async function currentAuthState(): Promise<AuthState> {
  const user = await ensureAnonymousAuth();
  if (!user) return null;
  return { uid: user.uid, isAnonymous: user.isAnonymous, name: user.displayName };
}

/**
 * 구글 계정 연동. **익명 계정을 승격시키는 것**이지 새 계정을 만드는 게 아니다.
 * uid 가 유지되므로 연동 전에 만든 기록이 그대로 이어진다.
 *
 * 이미 그 구글 계정으로 다른 익명 계정을 승격한 적이 있으면
 * `credential-already-in-use` 가 나온다. 그때는 그 계정으로 갈아탄다 —
 * 사용자 입장에서는 "이미 저장해 둔 내 계정"이 맞다.
 */
export async function linkGoogleAccount(): Promise<{ ok: true; name: string | null } | { ok: false; reason: string }> {
  const mod = await loadAuth();
  const app = ensureApp();
  if (!mod || !app) return { ok: false, reason: "auth-unavailable" };

  const auth = mod.getAuth(app);
  const user = auth.currentUser ?? (await ensureAnonymousAuth());
  if (!user) return { ok: false, reason: "auth-unavailable" };

  const provider = new mod.GoogleAuthProvider();
  try {
    const result = await mod.linkWithPopup(user, provider);
    return { ok: true, name: result.user.displayName };
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    if (code === "auth/credential-already-in-use" || code === "auth/email-already-in-use") {
      try {
        const result = await mod.signInWithPopup(auth, provider);
        return { ok: true, name: result.user.displayName };
      } catch (inner) {
        console.error("구글 로그인 실패", inner);
        return { ok: false, reason: "sign-in-failed" };
      }
    }
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
      return { ok: false, reason: "cancelled" };
    }
    console.error("구글 연동 실패", error);
    return { ok: false, reason: "link-failed" };
  }
}

/**
 * 백업 코드로 받은 커스텀 토큰으로 갈아탄다.
 *
 * 지금 이 기기의 uid 를 버리고, 코드가 가리키던 uid 로 로그인한다. 구글
 * 연동과 달리 **지금 uid 는 사라진다** — 새 기기에서 막 생긴 익명 uid는
 * 아직 아무것도 저장하지 않았을 것이므로 잃을 게 없다는 전제다.
 */
export async function signInWithBackupToken(customToken: string): Promise<{ ok: true } | { ok: false }> {
  const mod = await loadAuth();
  const app = ensureApp();
  if (!mod || !app) return { ok: false };
  try {
    await mod.signInWithCustomToken(mod.getAuth(app), customToken);
    return { ok: true };
  } catch (error) {
    console.error("백업 코드 로그인 실패", error);
    return { ok: false };
  }
}

async function collectAuthHeaders(): Promise<Record<string, string>> {
  const [appCheck, user] = await Promise.all([appCheckHeaders(), ensureAnonymousAuth()]);
  if (!user) return appCheck;
  try {
    return { ...appCheck, Authorization: `Bearer ${await user.getIdToken()}` };
  } catch (error) {
    console.error("ID 토큰 발급 실패", error);
    return appCheck;
  }
}

/**
 * 인증 헤더를 기다리는 상한.
 *
 * `ensureAnonymousAuth` 는 `onAuthStateChanged` 가 한 번 울리기를 기다린다.
 * WebView 처럼 IndexedDB 나 저장소 접근이 막힌 환경에서는 그게 **영영 안 울릴
 * 수 있다.** 그러면 예외도 안 나고 요청도 안 나가서 화면만 돈다 — 가장 고치기
 * 어려운 종류의 고장이다.
 */
const AUTH_HEADER_TIMEOUT_MS = 4000;

/**
 * API 호출용 헤더. App Check 토큰과 ID 토큰을 함께 싣는다.
 * 인증을 못 얻어도 요청은 보낸다 — 로그인은 통계·속도제한 수단이지
 * 서비스 이용 조건이 아니다. 기다리다 못 얻는 것도 못 얻는 것으로 친다.
 */
export async function requestHeaders(): Promise<Record<string, string>> {
  const timedOut = Symbol("timeout");
  const headers = await Promise.race([
    collectAuthHeaders(),
    new Promise<typeof timedOut>((resolve) => setTimeout(() => resolve(timedOut), AUTH_HEADER_TIMEOUT_MS)),
  ]);
  if (headers === timedOut) {
    console.warn("인증 헤더 시간 초과 — 인증 없이 요청합니다");
    return {};
  }
  return headers;
}
