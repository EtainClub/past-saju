import { appCheckResponse, verifyAppCheck } from "@/lib/app-check";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { clientKey, readBoundedBody } from "@/lib/request-guard";
import { identify } from "@/lib/auth";
import { isValidFortuneDate, seoulToday, todayFortune } from "@/lib/fortune/today";
import type { BirthInput } from "@/lib/reading-types";

export const runtime = "nodejs";

/**
 * 오늘의 운세.
 *
 * **LLM 도 Firestore 쓰기도 없다** — 명식 조회(`/api/chart`)와 같은 성격의
 * 순수 계산이라 속도 제한도 같은 버킷을 쓴다. 결정론이므로 서버 캐시도 두지
 * 않는다: 같은 입력이면 언제 불러도 같은 값이라, 캐시가 아낄 것이 계산 몇 밀리초뿐이다.
 *
 * 날짜는 **서버가 정한다**(KST 기준). 기기 시계를 그대로 믿으면 시간대가
 * 다른 곳에서 열었을 때 "오늘"이 사람마다 달라진다. 클라이언트가 보낸 날짜는
 * 형식과 범위를 검사한 뒤에만 받는다.
 */

/** 과거·미래를 무제한으로 열어 주지 않는다. 어제~모레면 충분하다. */
const DAY_WINDOW = 2;

function invalid(message: string) {
  return Response.json({ code: "invalid-input", message }, { status: 400 });
}

function withinWindow(date: string, today: string) {
  const diff = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  return Math.abs(diff) <= DAY_WINDOW;
}

export async function POST(request: Request) {
  const blocked = appCheckResponse(await verifyAppCheck(request), "fortune");
  if (blocked) return blocked;

  const requester = await identify(request);
  const verdict = await consumeRateLimit("feedback", requester.uid ? `uid:${requester.uid}` : clientKey(request));
  if (!verdict.ok) return rateLimitResponse(verdict);

  const body = await readBoundedBody(request);
  if (body.status !== "ok") return invalid("요청을 읽을 수 없어요.");

  let birth: BirthInput;
  let requested: string | undefined;
  try {
    ({ birth, date: requested } = JSON.parse(body.text) as { birth: BirthInput; date?: string });
  } catch {
    return invalid("요청을 읽을 수 없어요.");
  }
  if (!birth?.date) return invalid("생년월일을 입력해 주세요.");

  const today = seoulToday();
  const date = requested && isValidFortuneDate(requested) && withinWindow(requested, today) ? requested : today;

  try {
    return Response.json({ fortune: todayFortune(birth, date) });
  } catch (error) {
    // 음력 환산 실패 같은 입력 문제다. 500 이 아니다.
    console.error("오늘의 운세 계산 실패", error);
    return invalid("생년월일을 다시 확인해 주세요.");
  }
}
