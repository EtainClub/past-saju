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
 * 구글 연동까지 요구하는 이유: 익명 uid 는 브라우저 저장소가 비면 사라진다.
 * 1년을 약속하면서 열쇠가 먼저 사라지는 것은 약속이 아니다.
 */

function unauthenticated() {
  return Response.json(
    { code: "sign-in-required", message: "저장하려면 구글 계정 연동이 필요해요." },
    { status: 401 },
  );
}

/** 저장한 이야기 목록. */
export async function GET(request: Request) {
  const blocked = appCheckResponse(await verifyAppCheck(request), "reading/saved");
  if (blocked) return blocked;

  const requester = await identify(request);
  if (!requester.uid || !requester.linked) return unauthenticated();

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
  if (!requester.uid || !requester.linked) return unauthenticated();

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

