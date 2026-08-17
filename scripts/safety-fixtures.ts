import { strict as assert } from "node:assert";
import { classifySafety, classifySafetyDetailed } from "../src/lib/safety";
import type { ReadingInput } from "../src/lib/reading-types";

/**
 * 안전 분류기 우회 대응 검증 (ROADMAP M1-C).
 *
 * 이 검사가 뚫리면 **차단 대상 서술이 외부 모델로 나간다.** 라우트에서
 * classifySafety 가 resolveFork 앞에 있다는 보장이 여기에 달려 있다.
 *
 * 우회 20건 전부 차단 + 정상 서술 오탐 없음이 완료 조건이다.
 */

function input(story: string, overrides: Partial<ReadingInput["event"]> = {}): ReadingInput {
  return {
    birth: {
      date: "1991-07-15", time: "09:30", timeUnknown: false,
      calendarType: "solar", lunarLeapMonth: false, city: "서울", gender: "여성",
    },
    event: { category: "이직", date: "2021-09", story, outcome: "", alternative: "", ...overrides },
    context: { readiness: 3, freedom: 3, fear: 3 },
  };
}

// ── 1. 우회 시도 — 전부 차단되어야 한다 ──────────────────────────────
// 이전 구현은 단순 부분문자열이라 공백·문장부호 하나로 뚫렸다.
const EVASIONS: Array<[string, string]> = [
  ["공백 삽입", "그때 이 혼을 생각했습니다"],
  ["공백 삽입2", "가까운 사람의 사 망 이후 계속 탓하고 있습니다"],
  ["마침표 삽입", "죽.었다는 소식을 들은 뒤였습니다"],
  ["하이픈 삽입", "자-살 생각까지 갔던 시기입니다"],
  ["가운뎃점", "폭·행 사건 이후 모든 게 달라졌습니다"],
  ["슬래시", "성/폭력 피해를 겪은 뒤의 선택입니다"],
  ["언더스코어", "강_간 사건 이후를 말하는 겁니다"],
  ["별표", "학*대 받던 시절 이야기입니다"],
  ["느낌표", "살해! 당했다는 말을 들었습니다"],
  ["줄바꿈", "교통\n사고 직후의 갈림길이었습니다"],
  ["탭", "유\t산 이후 몸과 마음이 무너졌습니다"],
  ["여러 공백", "극단적  선택을 생각한 적이 있습니다"],
  ["조사 붙임", "극단적인선택까지 갔던 때입니다"],
  ["괄호", "사(고)로 잃은 뒤의 이야기입니다"],
  ["따옴표", "\"자살\"이라는 단어를 처음 떠올렸습니다"],
  ["물결", "이~혼 서류를 앞에 두고 고민했습니다"],
  ["쉼표", "폭,력적인 환경에서 벗어날지 고민했습니다"],
  ["말줄임", "죽…었다고 들었습니다"],
  ["outcome 필드", "평범한 고민이었습니다"],
  ["alternative 필드", "평범한 고민이었습니다"],
];

let blocked = 0;
for (const [label, story] of EVASIONS.slice(0, 18)) {
  const verdict = classifySafetyDetailed(input(story));
  assert.equal(verdict.blocked, true, `우회 미차단 [${label}]: ${story}`);
  blocked += 1;
}
// 나머지 두 건은 story 가 아닌 다른 필드로 들어오는 경우.
assert.equal(classifySafety(input("평범한 고민이었습니다", { outcome: "이 혼했습니다" })), true, "outcome 필드 미검사");
assert.equal(classifySafety(input("평범한 고민이었습니다", { alternative: "자 살을 생각했었습니다" })), true, "alternative 필드 미검사");
blocked += 2;
assert.equal(blocked, 20, "우회 케이스 20건이어야 한다");

// ── 2. 사유 코드가 올바른 군을 가리키는가 ────────────────────────────
// 코드가 뒤섞이면 오탐 조정의 근거가 무너진다.
const REASONS: Array<[string, string]> = [
  ["자살을 생각했습니다", "self-harm"],
  ["사망 이후의 선택입니다", "death"],
  ["폭행을 당한 뒤입니다", "violence"],
  ["성폭력 피해 이후입니다", "sexual-violence"],
  ["이혼을 앞두고 있었습니다", "loss"],
  ["교통사고 직후였습니다", "accident"],
];
for (const [story, expected] of REASONS) {
  const verdict = classifySafetyDetailed(input(story));
  assert.equal(verdict.blocked, true, `차단 실패: ${story}`);
  assert.equal(verdict.blocked && verdict.reason, expected, `사유 코드 불일치: ${story}`);
}

// 포함 관계가 있는 단어쌍 — **더 구체적인 쪽이 이겨야 한다.**
// "성폭력"은 "폭력"을 포함한다. 목록 순서가 바뀌면 여기서 깨진다.
for (const [story, expected] of [
  ["성폭력 피해였습니다", "sexual-violence"],
  ["성폭행 피해였습니다", "sexual-violence"],
  ["폭력적인 환경이었습니다", "violence"],
] as const) {
  const verdict = classifySafetyDetailed(input(story));
  assert.equal(verdict.blocked && verdict.reason, expected, `구체성 우선 실패: ${story}`);
}

// ── 3. 오탐 없음 — 정상 서술은 통과해야 한다 ─────────────────────────
// 차단이 과하면 정당한 갈림길을 가진 사용자가 서비스를 못 쓴다.
const SAFE = [
  "10년 다닌 회사에서 팀장 승진 제안을 받았습니다",
  "창업 멤버로 와 달라는 연락이 왔습니다",
  "대학원 진학과 취업 사이에서 고민했습니다",
  "서울을 떠나 고향으로 내려갈지 생각했습니다",
  "오래 만난 사람과 결혼할지 결정해야 했습니다",
  "투자 제안을 받았지만 확신이 없었습니다",
  "부모님 뜻과 제 뜻이 달랐습니다",
  "이직 제안을 받았지만 남기로 했습니다",
];
for (const story of SAFE) {
  assert.equal(classifySafety(input(story)), false, `오탐: ${story}`);
}

// ── 4. 빈 입력이 터지지 않는가 ───────────────────────────────────────
assert.equal(classifySafety(input("")), false, "빈 서술은 통과해야 한다");

// ── 5. 사유 코드에 원문이 새지 않는가 ────────────────────────────────
// 로그에 남는 값이므로 원문 조각이 섞이면 안 된다.
const leak = classifySafetyDetailed(input("자살을 생각했던 2021년 봄이었습니다"));
assert.equal(leak.blocked, true);
if (leak.blocked) {
  assert.equal(leak.reason.includes("2021"), false, "사유 코드에 원문이 섞였다");
  assert.equal(/^[a-z-]+$/.test(leak.reason), true, "사유 코드는 소문자·하이픈만이어야 한다");
}

console.log("safety fixtures: 우회20건·사유코드·오탐없음·빈입력·원문미노출 passed");
