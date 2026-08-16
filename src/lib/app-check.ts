import { getAppCheck } from "firebase-admin/app-check";
import { getFirebaseAdminApp } from "./firebase-admin";

/**
 * Firebase App Check 토큰 검증 (서버 측).
 *
 * 클라이언트 연동은 콘솔에서 reCAPTCHA Enterprise 사이트 키를 발급받아야 시작할 수
 * 있으므로 아직 붙지 않았다. 그때까지는 속도 제한(rate-limit.ts)이 실질 방어다.
 *
 * APP_CHECK_MODE:
 *   off      — 검증하지 않음 (기본, 로컬 개발)
 *   monitor  — 검증하고 로그만 남김. 클라이언트 연동 직후 오탐 확인용
 *   enforce  — 토큰이 없거나 유효하지 않으면 401
 *
 * A2(첫 LLM 호출) 전에 enforce로 올려야 한다.
 */
export type AppCheckMode = "off" | "monitor" | "enforce";
export type AppCheckVerdict = "ok" | "missing" | "invalid" | "skipped";

const HEADER = "x-firebase-appcheck";

export function appCheckMode(): AppCheckMode {
  const raw = process.env.APP_CHECK_MODE;
  if (raw === "enforce" || raw === "monitor" || raw === "off") return raw;
  // 프로덕션 기본값은 monitor다. 클라이언트가 아직 토큰을 보내지 않는 상태에서
  // enforce를 기본으로 두면 정상 사용자가 전부 401을 받는다.
  return process.env.NODE_ENV === "production" ? "monitor" : "off";
}

export async function verifyAppCheck(request: Request): Promise<AppCheckVerdict> {
  const mode = appCheckMode();
  if (mode === "off") return "skipped";

  const token = request.headers.get(HEADER);
  if (!token) return "missing";

  try {
    await getAppCheck(getFirebaseAdminApp()).verifyToken(token);
    return "ok";
  } catch {
    return "invalid";
  }
}

/** enforce 모드에서만 막는다. monitor 모드는 로그만 남기고 통과시킨다. */
export function appCheckResponse(verdict: AppCheckVerdict, route: string): Response | null {
  if (verdict === "ok" || verdict === "skipped") return null;
  if (appCheckMode() !== "enforce") {
    console.warn(`App Check ${verdict} (monitor): ${route}`);
    return null;
  }
  return Response.json(
    { code: "app-check-failed", message: "앱 인증에 실패했어요. 브라우저를 새로고침한 뒤 다시 시도해 주세요." },
    { status: 401 },
  );
}
