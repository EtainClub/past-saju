import { appCheckResponse, verifyAppCheck } from "@/lib/app-check";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { clientKey, readBoundedBody } from "@/lib/request-guard";
import { identify } from "@/lib/auth";
import { summarizeChart } from "@/lib/chart/summary";
import type { BirthInput } from "@/lib/reading-types";

export const runtime = "nodejs";

/**
 * 명식 조회.
 *
 * **LLM 도 Firestore 쓰기도 없다.** 순수 계산이라 세션 생성보다 훨씬 싸므로
 * 속도 제한도 넉넉한 버킷(feedback)을 쓴다. 그래도 무제한은 아니다 —
 * 무인증 공개 엔드포인트이므로 남용 여지를 남기지 않는다.
 */

function invalid(message: string) {
  return Response.json({ code: "invalid-input", message }, { status: 400 });
}

export async function POST(request: Request) {
  const blocked = appCheckResponse(await verifyAppCheck(request), "chart");
  if (blocked) return blocked;

  const requester = await identify(request);
  const verdict = await consumeRateLimit("feedback", requester.uid ? `uid:${requester.uid}` : clientKey(request));
  if (!verdict.ok) return rateLimitResponse(verdict);

  const body = await readBoundedBody(request);
  if (body.status !== "ok") return invalid("요청을 읽을 수 없어요.");

  let birth: BirthInput;
  try {
    ({ birth } = JSON.parse(body.text) as { birth: BirthInput });
  } catch {
    return invalid("요청을 읽을 수 없어요.");
  }
  if (!birth?.date) return invalid("생년월일을 입력해 주세요.");

  try {
    return Response.json({ chart: summarizeChart(birth) });
  } catch (error) {
    // 유효하지 않은 날짜(음력 환산 실패 등)는 사용자 입력 문제다. 500 이 아니다.
    console.error("명식 계산 실패", error);
    return invalid("생년월일을 다시 확인해 주세요.");
  }
}
