import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { ANONYMOUS_REQUESTER, identify } from "../src/lib/auth";
import { listSavedReadings, markSessionSaved, saveReadingSession } from "../src/lib/reading-store";
import { createReadingSession } from "../src/lib/reading-engine";
import type { ReadingInput } from "../src/lib/reading-types";

/**
 * 인증·보관 검증.
 *
 * 핵심은 **격리**다. 세션 id 는 응답에 실려 클라이언트로 나가므로, id 만 알면
 * 남의 기록을 보관 처리하거나 목록에서 볼 수 있으면 안 된다.
 */

function input(story = "회사를 옮길지 고민했습니다."): ReadingInput {
  return {
    birth: {
      date: "1991-07-15", time: "09:30", timeUnknown: false,
      calendarType: "solar", lunarLeapMonth: false, city: "서울", gender: "여성",
    },
    event: { category: "이직", date: "2021-09", story, outcome: "남았습니다.", alternative: "" },
    context: { readiness: 3, freedom: 3, fear: 3 },
  };
}

async function make(uid?: string) {
  const session = createReadingSession(input());
  if (uid) session.uid = uid;
  await saveReadingSession(session);
  return session;
}

async function main() {
// ── 1. 토큰이 없으면 익명. 401 이 아니다 ────────────────────────────────
// 인증은 이용 조건이 아니다. 막으면 로그인 없는 서비스라는 전제가 깨진다.
const NO_TOKEN: Record<string, string>[] = [
  {},
  { authorization: "" },
  { authorization: "Bearer" },
  { authorization: "Bearer " },
  { authorization: "Basic abc" },
];
for (const headers of NO_TOKEN) {
  const verdict = await identify(new Request("https://ifsaju.com", { headers }));
  assert.deepEqual(verdict, ANONYMOUS_REQUESTER, `익명으로 떨어져야 한다: ${JSON.stringify(headers)}`);
}

// 위조 토큰도 던지지 않고 익명으로 떨어진다.
const forged = await identify(new Request("https://ifsaju.com", {
  headers: { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1aWQiOiJhdHRhY2tlciJ9.zzz" },
}));
assert.deepEqual(forged, ANONYMOUS_REQUESTER, "위조 토큰은 익명 취급");

// ── 2. 남의 세션은 보관할 수 없다 ────────────────────────────────────────
const mine = await make("user-a");
assert.equal(await markSessionSaved(mine.id, "user-b"), "forbidden", "남의 세션을 보관 처리했다");
assert.equal(await markSessionSaved(mine.id, "user-a"), "saved", "본인 세션 보관 실패");

// ── 3. uid 없는 세션은 누구도 보관할 수 없다 ────────────────────────────
// 로그인 전에 만든 세션이다. 주인이 없으므로 아무나 가져갈 수 없어야 한다.
const orphan = await make();
assert.equal(await markSessionSaved(orphan.id, "user-a"), "forbidden", "주인 없는 세션을 가져갔다");

// ── 4. 없는 세션 ────────────────────────────────────────────────────────
assert.equal(await markSessionSaved("does-not-exist", "user-a"), "missing");

// ── 5. 목록은 본인 것만, 저장한 것만 ────────────────────────────────────
await make("user-a");            // 저장 안 함
const second = await make("user-a");
await markSessionSaved(second.id, "user-a");
const other = await make("user-b");
await markSessionSaved(other.id, "user-b");

const listA = await listSavedReadings("user-a");
assert.equal(listA.length, 2, `user-a 의 저장분은 2건이어야 한다 (실제 ${listA.length})`);
assert.equal(listA.every((item) => item.id !== other.id), true, "남의 기록이 목록에 섞였다");

const listB = await listSavedReadings("user-b");
assert.equal(listB.length, 1, "user-b 의 저장분은 1건");
assert.equal(listB[0].id, other.id);

// ── 6. 목록에 본문이 실리지 않는가 ──────────────────────────────────────
// 목록은 요약만 낸다. 서사 본문이 새면 노출 범위가 넓어진다.
const keys = Object.keys(listB[0]).sort().join(",");
assert.equal(keys, "category,createdAt,eventDate,id,slot,title", `목록 필드가 늘었다: ${keys}`);

// ── 7. 저장하면 만료가 실제로 밀리는가 ──────────────────────────────────
// saved 플래그만 세우고 TTL 을 안 밀면 7일에 그대로 지워진다.
const storeSource = readFileSync("src/lib/reading-store.ts", "utf8");
assert.equal(
  /transaction\.update\(ref, \{[\s\S]*?saved: true,[\s\S]*?expiresAt:/.test(storeSource),
  true,
  "보관 시 expiresAt 을 함께 갱신하지 않는다 — TTL 이 7일에 지운다",
);

  console.log("auth fixtures: 익명폴백·위조내성·본인확인·주인없음·목록격리·요약전용·TTL연장 passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
