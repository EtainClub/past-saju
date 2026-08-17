import { getAuth } from "firebase-admin/auth";
import { getFirebaseAdminApp } from "./firebase-admin";

/**
 * 요청자 신원 확인 (서버 측).
 *
 * **인증은 이용 조건이 아니다.** 토큰이 없거나 틀려도 요청은 통과한다 —
 * 로그인 벽은 결과 뒤에만 있고, 답변 자체는 누구나 본다. 여기서 얻는 것은
 * 두 가지뿐이다:
 *   1. 통계 — 실제 사용자 수와 재방문. IP 해시로는 알 수 없다
 *   2. 속도 제한 키 — 한국 이동통신 NAT 에서 IP 는 수천 명이 공유한다
 *
 * 따라서 검증 실패는 401 이 아니라 **익명 취급**이다. 조용히 열어 두는 게
 * 아니라, 열어 두는 것이 설계다(속도 제한은 IP 로 폴백한다).
 */
export type Requester = {
  uid: string | null;
  /** 구글 등 실제 계정에 연결됐는가. 익명 로그인만 한 경우 false. */
  linked: boolean;
};

export const ANONYMOUS_REQUESTER: Requester = { uid: null, linked: false };

/**
 * Firebase ID 토큰을 검증해 uid 와 연동 여부를 낸다.
 *
 * `firebase.sign_in_provider === "anonymous"` 면 익명이다. 그 외(google.com 등)면
 * 실계정에 연결된 것으로 본다 — **연동은 uid 를 유지한 채 provider 만 늘어나므로**
 * 익명 시절 기록이 그대로 이어진다.
 */
export async function identify(request: Request): Promise<Requester> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return ANONYMOUS_REQUESTER;

  const token = header.slice(7).trim();
  if (!token) return ANONYMOUS_REQUESTER;

  try {
    const decoded = await getAuth(getFirebaseAdminApp()).verifyIdToken(token);
    const provider = decoded.firebase?.sign_in_provider;
    return { uid: decoded.uid, linked: Boolean(provider) && provider !== "anonymous" };
  } catch {
    // 만료·위조 모두 여기로 온다. 막지 않고 익명으로 떨어뜨린다.
    return ANONYMOUS_REQUESTER;
  }
}
