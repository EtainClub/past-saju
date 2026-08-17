import { createReadingSession } from "@/lib/reading-engine";
import { classifySafetyDetailed, recordSafetyBlock } from "@/lib/safety";
import { resolveSolarBirthDate } from "@/lib/birth-date";
import { readingStoreBackend, saveReadingSession } from "@/lib/reading-store";
import type { BirthInput, ReadingInput } from "@/lib/reading-types";
import { appCheckResponse, verifyAppCheck } from "@/lib/app-check";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { clientKey, readBoundedBody } from "@/lib/request-guard";
import { identify } from "@/lib/auth";
import { resolveFork } from "@/lib/fork/resolve";

export const runtime = "nodejs";

function birthDateInKorea(birth: BirthInput) {
  const solarBirth = resolveSolarBirthDate(birth);
  if (!solarBirth) return null;
  const month = String(solarBirth.month).padStart(2, "0");
  const day = String(solarBirth.day).padStart(2, "0");
  return new Date(`${solarBirth.year}-${month}-${day}T00:00:00+09:00`);
}

function isReadingInput(value: unknown): value is ReadingInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<ReadingInput>;
  const birthDate = input.birth ? birthDateInKorea(input.birth) : null;
  const eventDate = input.event?.date ? new Date(`${input.event.date}-01T00:00:00+09:00`) : null;
  const now = new Date();
  return Boolean(
    input.birth?.date &&
    (input.birth.calendarType === "solar" || input.birth.calendarType === "lunar") &&
    typeof input.birth.lunarLeapMonth === "boolean" &&
    typeof input.birth.city === "string" && input.birth.city.trim().length > 0 && input.birth.city.length <= 80 &&
    input.event?.date &&
    input.event?.category &&
    input.event?.story &&
    input.event.story.trim().length >= 10 &&
    input.event.story.length <= 600 &&
    input.context &&
    birthDate && !Number.isNaN(birthDate.getTime()) && birthDate <= now &&
    eventDate && !Number.isNaN(eventDate.getTime()) && eventDate <= now && birthDate < eventDate &&
    [input.context.readiness, input.context.freedom, input.context.fear].every(
      (score) => typeof score === "number" && score >= 1 && score <= 5,
    ),
  );
}

function ageFromBirth(birthInput: BirthInput) {
  const birth = birthDateInKorea(birthInput);
  if (!birth) return -1;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export async function POST(request: Request) {
  const blocked = appCheckResponse(await verifyAppCheck(request), "reading/session");
  if (blocked) return blocked;

  // uid 가 있으면 그것으로, 없으면 IP 해시로 센다. 한국 이동통신 NAT 에서는
  // 수천 명이 같은 IP 를 쓰므로 uid 쪽이 훨씬 정확하다 — 익명 로그인을
  // 도입한 이유의 절반이 이것이다.
  const requester = await identify(request);
  const verdict = await consumeRateLimit("session", requester.uid ? `uid:${requester.uid}` : clientKey(request));
  if (!verdict.ok) return rateLimitResponse(verdict);

  const body = await readBoundedBody(request);
  if (body.status === "too-large") {
    return Response.json({ code: "payload-too-large", message: "입력이 너무 깁니다. 줄여서 다시 시도해 주세요." }, { status: 413 });
  }

  let input: unknown;
  try {
    if (body.status !== "ok") throw new Error("unreadable");
    input = JSON.parse(body.text);
  } catch {
    return Response.json({ code: "invalid-input", message: "입력 내용을 다시 확인해 주세요." }, { status: 400 });
  }

  if (!isReadingInput(input)) {
    return Response.json({ code: "invalid-input", message: "필수 입력을 모두 확인해 주세요." }, { status: 400 });
  }

  if (ageFromBirth(input.birth) < 14) {
    return Response.json({ code: "under-age", message: "만 14세 이상만 이용할 수 있어요." }, { status: 403 });
  }

  const safety = classifySafetyDetailed(input);
  if (safety.blocked) {
    // 사유 코드만 남긴다. 원문은 어디에도 저장하지 않는다.
    // 이 집계가 있어야 오탐(정당한 소재인데 막힌 경우)을 근거로 조정할 수 있다.
    await recordSafetyBlock(safety.reason);
    return Response.json(
      {
        code: "blocked-content",
        message: "이 이야기는 자동 해석보다 사람의 이야기로 다뤄지는 편이 좋겠어요.",
        support: "지금 마음이 무겁다면 자살예방상담 109 또는 정신건강 위기상담 1577-0199에서 이야기 나눌 수 있어요.",
      },
      { status: 422 },
    );
  }

  // L2 — 갈림길 이해. classifySafety 통과 이후에만 호출한다.
  // 차단 대상 서술은 외부로 나가지 않는다.
  const fork = await resolveFork(input);
  const session = createReadingSession(input, fork);
  // 누가 만든 세션인지 적어 둔다. 나중에 저장을 누를 때 본인 확인의 근거가 되고,
  // 재열람 목록의 열쇠가 된다. 구글 연동을 해도 uid 는 바뀌지 않는다.
  if (requester.uid) session.uid = requester.uid;
  try {
    await saveReadingSession(session);
  } catch (error) {
    console.error("Firebase 세션 저장 실패", error);
    return Response.json(
      { code: "storage-unavailable", message: "기록 저장소에 잠시 연결할 수 없어요. 잠시 뒤 다시 시도해 주세요." },
      { status: 503 },
    );
  }

  return Response.json({
    sessionId: session.id,
    cardSlots: ["left", "center", "right"],
    choiceCommitments: session.choiceCommitments,
    sessionCommitment: session.sessionCommitment,
    engineVersion: "saju-1.0-eokbu+manseryeok-2.0.0-kasi",
    ...(process.env.NODE_ENV !== "production" ? { storageBackend: readingStoreBackend() } : {}),
  });
}
