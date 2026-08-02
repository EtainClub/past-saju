import { classifySafety, createReadingSession } from "@/lib/reading-engine";
import { resolveSolarBirthDate } from "@/lib/birth-date";
import { readingStoreBackend, saveReadingSession } from "@/lib/reading-store";
import type { BirthInput, ReadingInput } from "@/lib/reading-types";

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
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ code: "invalid-input", message: "입력 내용을 다시 확인해 주세요." }, { status: 400 });
  }

  if (!isReadingInput(input)) {
    return Response.json({ code: "invalid-input", message: "필수 입력을 모두 확인해 주세요." }, { status: 400 });
  }

  if (ageFromBirth(input.birth) < 14) {
    return Response.json({ code: "under-age", message: "만 14세 이상만 이용할 수 있어요." }, { status: 403 });
  }

  if (classifySafety(input)) {
    return Response.json(
      {
        code: "blocked-content",
        message: "이 이야기는 자동 해석보다 사람의 이야기로 다뤄지는 편이 좋겠어요.",
        support: "지금 마음이 무겁다면 자살예방상담 109 또는 정신건강 위기상담 1577-0199에서 이야기 나눌 수 있어요.",
      },
      { status: 422 },
    );
  }

  const session = createReadingSession(input);
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
