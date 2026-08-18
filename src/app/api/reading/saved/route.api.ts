import { appCheckResponse, verifyAppCheck } from "@/lib/app-check";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { readBoundedBody } from "@/lib/request-guard";
import { identify } from "@/lib/auth";
import { listSavedReadings, markSessionSaved } from "@/lib/reading-store";

export const runtime = "nodejs";

/**
 * 이야기 보관과 목록.
 *
 * **여기서만 로그인이 필요하다.** 서비스 이용과 LLM 답변은 로그인 없이도
 * 되지만, "오래 두고 다시 보기"는 누구 것인지 알아야 성립한다.
 *
 * 익명 로그인 uid 만으로 충분하다 — 구글 연동을 요구하지 않는다. 기기를
 * 바꾸면 uid 를 잃는다는 문제는 여전하지만, 이제 백업 코드
 * (`/api/auth/backup-code`, `lib/backup-code.ts`)가 그 열쇠를 대신 쥔다.
 * 토스 미니앱은 애초에 구글 연동이 안 되므로(`lib/platform.ts`) 이 완화가
 * 없으면 미니앱에서는 보관 기능 자체가 성립하지 않는다.
 */

function unauthenticated() {
  return Response.json(
    { code: "sign-in-required", message: "인증에 실패했어요. 새로고침한 뒤 다시 시도해 주세요." },
    { status: 401 },
  );
}

/** 저장한 이야기 목록. */
export async function GET(request: Request) {
  const blocked = appCheckResponse(await verifyAppCheck(request), "reading/saved");
  if (blocked) return blocked;

  const requester = await identify(request);
  if (!requester.uid) return unauthenticated();

  const verdict = await consumeRateLimit("feedback", `uid:${requester.uid}`);
  if (!verdict.ok) return rateLimitResponse(verdict);

  try {
    return Response.json({ readings: await listSavedReadings(requester.uid) });
  } catch (error) {
    console.error("저장 목록 조회 실패", error);
    return Response.json(
      { code: "storage-unavailable", message: "기록 저장소에 잠시 연결할 수 없어요." },
      { status: 503 },
    );
  }
}

/** 이 세션을 장기 보관으로 표시한다. */
export async function POST(request: Request) {
  const blocked = appCheckResponse(await verifyAppCheck(request), "reading/saved");
  if (blocked) return blocked;

  const requester = await identify(request);
  if (!requester.uid) return unauthenticated();

  const verdict = await consumeRateLimit("feedback", `uid:${requester.uid}`);
  if (!verdict.ok) return rateLimitResponse(verdict);

  const body = await readBoundedBody(request);
  if (body.status !== "ok") {
    return Response.json({ code: "invalid-input", message: "요청을 읽을 수 없어요." }, { status: 400 });
  }

  let sessionId: string | undefined;
  try {
    ({ sessionId } = JSON.parse(body.text) as { sessionId?: string });
  } catch {
    return Response.json({ code: "invalid-input", message: "요청을 읽을 수 없어요." }, { status: 400 });
  }
  if (!sessionId) {
    return Response.json({ code: "invalid-input", message: "세션을 찾을 수 없어요." }, { status: 400 });
  }

  try {
    const result = await markSessionSaved(sessionId, requester.uid);
    if (result === "missing") {
      return Response.json({ code: "not-found", message: "이미 지워졌거나 없는 기록이에요." }, { status: 404 });
    }
    // 남의 세션 id 를 넣어도 남의 기록을 보관 처리할 수 없다.
    if (result === "forbidden") {
      return Response.json({ code: "forbidden", message: "이 기록은 저장할 수 없어요." }, { status: 403 });
    }
    return Response.json({ saved: true });
  } catch (error) {
    console.error("이야기 보관 실패", error);
    return Response.json(
      { code: "storage-unavailable", message: "기록 저장소에 잠시 연결할 수 없어요." },
      { status: 503 },
    );
  }
}

