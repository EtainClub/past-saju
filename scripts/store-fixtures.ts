import { strict as assert } from "node:assert";
import { createReadingSession } from "../src/lib/reading-engine";
import {
  markReadingCompleted,
  readingStoreBackend,
  saveReadingFeedback,
  saveReadingSession,
  selectReadingSession,
} from "../src/lib/reading-store";
import type { ReadingInput } from "../src/lib/reading-types";

const input: ReadingInput = {
  birth: {
    date: "1991-07-15",
    calendarType: "solar",
    lunarLeapMonth: false,
    time: "09:30",
    timeUnknown: false,
    city: "서울",
    gender: "응답 안 함",
  },
  event: {
    category: "이직",
    date: "2021-09",
    story: "오랫동안 다닌 회사를 떠날 기회가 있었지만 안정을 선택해 남았습니다.",
    outcome: "결국 남았습니다.",
    alternative: "그때 떠났다면 어땠을지 생각했습니다.",
  },
  context: { readiness: 3, freedom: 4, fear: 4 },
};

async function main() {
  delete process.env.FIREBASE_STORAGE_BACKEND;
  delete process.env.FIRESTORE_EMULATOR_HOST;
  assert.equal(readingStoreBackend(), "memory", "테스트는 외부 Firebase를 변경하면 안 됩니다.");

  const session = createReadingSession(input);
  await saveReadingSession(session);

  const first = await selectReadingSession(session.id, 0);
  assert.equal(first.status, "ok");
  if (first.status === "ok") assert.equal(first.firstSelection, true);

  const repeated = await selectReadingSession(session.id, 0);
  assert.equal(repeated.status, "ok");
  if (repeated.status === "ok") assert.equal(repeated.firstSelection, false);

  assert.deepEqual(await selectReadingSession(session.id, 1), { status: "conflict" });
  assert.equal(await saveReadingFeedback(session.id, "plausible"), "saved");
  assert.equal(await saveReadingFeedback(session.id, "plausible"), "duplicate");
  assert.equal(await saveReadingFeedback("missing-session", "uncertain"), "missing");

  await markReadingCompleted(session.id);
  await markReadingCompleted(session.id);
  console.log("store fixtures: selection lock, feedback dedupe, completion idempotency passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
