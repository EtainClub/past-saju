import { appCheckResponse, verifyAppCheck } from "@/lib/app-check";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { identify } from "@/lib/auth";
import { issueBackupCode } from "@/lib/backup-code";

export const runtime = "nodejs";

/**
 * 백업 코드 발급.
 *
 * 익명 로그인만 한 사용자도 받을 수 있다 — 오히려 그 경우가 이 기능이
 * 존재하는 이유다(구글 연동이 안 되는 토스 미니앱, 또는 아직 연동을 안 한
 * 웹 사용자). 구글 연동과 달리 uid 를 승격시키지 않으므로 몇 번을 눌러도
 * 그냥 지금 uid 를 가리키는 코드가 하나 더 나올 뿐이다.
 */
export async function POST(request: Request) {
  const blocked = appCheckResponse(await verifyAppCheck(request), "auth/backup-code");
  if (blocked) return blocked;

  const requester = await identify(request);
  if (!requester.uid) {
    return Response.json(
      { code: "sign-in-required", message: "인증에 실패했어요. 새로고침한 뒤 다시 시도해 주세요." },
      { status: 401 },
    );
  }

  const verdict = await consumeRateLimit("authBackup", `uid:${requester.uid}`);
  if (!verdict.ok) return rateLimitResponse(verdict);

  try {
    const { code, expiresAt } = await issueBackupCode(requester.uid);
    return Response.json({ code, expiresAt });
  } catch (error) {
    console.error("백업 코드 발급 실패", error);
    return Response.json(
      { code: "storage-unavailable", message: "잠시 뒤 다시 시도해 주세요." },
      { status: 503 },
    );
  }
}
