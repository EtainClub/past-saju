import { getAuth } from "firebase-admin/auth";
import { getFirebaseAdminApp } from "@/lib/firebase-admin";
import { appCheckResponse, verifyAppCheck } from "@/lib/app-check";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { clientKey, readBoundedBody } from "@/lib/request-guard";
import { redeemBackupCode } from "@/lib/backup-code";

export const runtime = "nodejs";

/**
 * 백업 코드 → 커스텀 토큰.
 *
 * 새 기기에는 이미 새 익명 uid 가 생겨 있다. 여기서 그 uid 로 "로그인"하는
 * 게 아니라, 코드가 가리키는 **원래 uid 로 갈아탈 토큰**을 준다 — 구글
 * 연동(linkWithPopup)이 uid 를 유지하는 것과 같은 효과를 실계정 없이 낸다.
 *
 * 이 요청 시점엔 아직 어느 uid 인지 모른다(그게 이 요청의 목적이다). 그래서
 * IP 기준으로 제한한다 — 코드는 무작위 대입으로 못 맞힐 만큼 길지만,
 * 시도 자체를 늦추는 것도 방어선이다.
 */
export async function POST(request: Request) {
  const blocked = appCheckResponse(await verifyAppCheck(request), "auth/recover");
  if (blocked) return blocked;

  const verdict = await consumeRateLimit("authRecovery", clientKey(request));
  if (!verdict.ok) return rateLimitResponse(verdict);

  const body = await readBoundedBody(request, 1024);
  if (body.status !== "ok") {
    return Response.json({ code: "invalid-input", message: "요청을 읽을 수 없어요." }, { status: 400 });
  }

  let code: string | undefined;
  try {
    ({ code } = JSON.parse(body.text) as { code?: string });
  } catch {
    return Response.json({ code: "invalid-input", message: "요청을 읽을 수 없어요." }, { status: 400 });
  }
  if (!code) {
    return Response.json({ code: "invalid-input", message: "코드를 입력해 주세요." }, { status: 400 });
  }

  const result = await redeemBackupCode(code);
  if (result.status === "not-found") {
    return Response.json({ code: "not-found", message: "코드를 찾을 수 없어요. 다시 확인해 주세요." }, { status: 404 });
  }

  try {
    const customToken = await getAuth(getFirebaseAdminApp()).createCustomToken(result.uid);
    return Response.json({ customToken });
  } catch (error) {
    console.error("복구 토큰 발급 실패", error);
    return Response.json(
      { code: "storage-unavailable", message: "잠시 뒤 다시 시도해 주세요." },
      { status: 503 },
    );
  }
}
