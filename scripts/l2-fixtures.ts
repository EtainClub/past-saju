import { strict as assert } from "node:assert";
import { groundEvidence, isGrounded } from "../src/lib/fork/evidence";
import { resolveFork } from "../src/lib/fork/resolve";
import { forkStatsSnapshot } from "../src/lib/queue/unknowns";
import { llmEnabled } from "../src/lib/llm/client";
import { reserveLlmCall, DAILY_CALL_BUDGET } from "../src/lib/llm/budget";
import { createReadingSession } from "../src/lib/reading-engine";
import type { ReadingInput } from "../src/lib/reading-types";

const STORY = "10년 다닌 회사에서 팀장 승진 제안을 받았지만 거절했습니다.";

function fixture(event: Partial<ReadingInput["event"]> = {}): ReadingInput {
  return {
    birth: { date: "1991-07-15", calendarType: "solar", lunarLeapMonth: false, time: "09:30", timeUnknown: false, city: "서울", gender: "여성" },
    event: { category: "이직", date: "2021-09", story: STORY, outcome: "", alternative: "", ...event },
    context: { readiness: 3, freedom: 4, fear: 4 },
  };
}

// ── 1. 발췌 검증: 원문에 있는 것만 통과 ─────────────────────────────────────
function evidenceMustBeGrounded() {
  assert.equal(isGrounded("10년 다닌 회사", STORY), true, "원문 그대로면 통과해야 합니다.");
  assert.equal(isGrounded("10년다닌회사", STORY), true, "띄어쓰기 차이는 허용합니다.");
  assert.equal(isGrounded("팀장 승진 제안을 받았지만", STORY), true);

  // 지어낸 세부는 전부 떨어져야 한다 — 이 검사가 L5 날조 방지의 핵심이다.
  assert.equal(isGrounded("판교에 있는 회사", STORY), false, "원문에 없는 지명은 막아야 합니다.");
  assert.equal(isGrounded("연봉 8000만원", STORY), false, "원문에 없는 수치는 막아야 합니다.");
  assert.equal(isGrounded("김 부장", STORY), false, "원문에 없는 인물은 막아야 합니다.");
  assert.equal(isGrounded("회사를 10년 다닌", STORY), false, "어순을 바꾼 재작성은 막아야 합니다.");
  assert.equal(isGrounded("", STORY), false);
}

// ── 2. 근거 없는 항목만 떨어뜨리고 분류는 살린다 ────────────────────────────
function ungroundedItemsAreDropped() {
  const { evidence, dropped } = groundEvidence(
    {
      subject: "10년 다닌 회사",
      stakes: ["팀장 승진 제안", "연봉 8000만원"],
      constraint: "판교로 이사해야 했다",
      quotes: ["거절했습니다", "동료들이 말렸다"],
    },
    STORY,
  );
  assert.equal(evidence.subject, "10년 다닌 회사", "근거 있는 항목은 남아야 합니다.");
  assert.deepEqual(evidence.stakes, ["팀장 승진 제안"], "근거 없는 항목만 빠져야 합니다.");
  assert.equal(evidence.constraint, null);
  assert.deepEqual(evidence.quotes, ["거절했습니다"]);
  assert.equal(dropped, 3, "떨어뜨린 개수를 세어야 합니다.");
}

// ── 3. 패턴이 히트하면 LLM을 부르지 않는다 (비용 0) ─────────────────────────
async function patternHitSkipsLlm() {
  const before = forkStatsSnapshot();
  const result = await resolveFork(fixture({ outcome: "결국 퇴사했습니다." }));
  assert.equal(result.status, "CLASSIFIED");
  assert.equal(result.status === "CLASSIFIED" && result.frame.key.source, "pattern", "패턴으로 끝나야 합니다.");
  assert.equal(forkStatsSnapshot().classified, before.classified + 1);
  assert.equal(forkStatsSnapshot().unknown, before.unknown, "패턴 히트는 미분류로 세면 안 됩니다.");
}

// ── 4. 킬스위치가 꺼져 있으면 미분류로 떨어지고 큐에 쌓인다 ─────────────────
async function killSwitchFallsBackToUnknown() {
  const previous = process.env.LLM_ENABLED;
  process.env.LLM_ENABLED = "false";
  assert.equal(llmEnabled(), false, "킬스위치가 우선해야 합니다.");

  const before = forkStatsSnapshot();
  const result = await resolveFork(fixture({ story: "그 무렵의 일을 자주 떠올립니다." }));
  assert.equal(result.status, "UNKNOWN", "판정 근거가 없으면 UNKNOWN 이어야 합니다.");
  assert.equal(forkStatsSnapshot().unknown, before.unknown + 1, "미분류는 지표에 기록되어야 합니다.");

  if (previous === undefined) delete process.env.LLM_ENABLED;
  else process.env.LLM_ENABLED = previous;
}

// ── 5. 미분류여도 서사는 정상 생성된다 (폴백 = 현행 동작) ────────────────────
async function unknownStillRenders() {
  const previous = process.env.LLM_ENABLED;
  process.env.LLM_ENABLED = "false";

  const input = fixture({ story: "그 무렵의 일을 자주 떠올립니다." });
  const fork = await resolveFork(input);
  const session = createReadingSession(input, fork);
  assert.equal(session.choices.length, 3, "미분류여도 세 갈래는 나와야 합니다.");
  assert.match(session.choices[0].result.basis.eventFlow, /확정하지 못해/, "미분류 사실을 근거란에 밝혀야 합니다.");

  if (previous === undefined) delete process.env.LLM_ENABLED;
  else process.env.LLM_ENABLED = previous;
}

// ── 6. 일일 예산은 상한에서 멈춘다 ──────────────────────────────────────────
async function budgetStopsAtCap() {
  let granted = 0;
  for (let index = 0; index < DAILY_CALL_BUDGET + 5; index += 1) {
    if (await reserveLlmCall()) granted += 1;
  }
  assert.equal(granted, DAILY_CALL_BUDGET, `예산은 ${DAILY_CALL_BUDGET}건에서 멈춰야 합니다.`);
  assert.equal(await reserveLlmCall(), false, "상한 이후에는 계속 거절해야 합니다.");
}

// ── 7. 예산이 바닥나면 LLM을 부르지 않고 미분류로 간다 ──────────────────────
async function exhaustedBudgetSkipsLlm() {
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key-not-used";
  assert.equal(llmEnabled(), true);

  // 6번에서 이미 예산을 소진했으므로 LLM 호출 없이 즉시 미분류여야 한다.
  const result = await resolveFork(fixture({ story: "그 무렵의 일을 자주 떠올립니다." }));
  assert.equal(result.status, "UNKNOWN");
  assert.equal((result as { reason: string }).reason, "budget-exhausted", "예산 소진 사유를 남겨야 합니다.");

  if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = previous;
}

async function main() {
  evidenceMustBeGrounded();
  ungroundedItemsAreDropped();
  await patternHitSkipsLlm();
  await killSwitchFallsBackToUnknown();
  await unknownStillRenders();
  await budgetStopsAtCap();
  await exhaustedBudgetSkipsLlm();
  console.log("l2 fixtures: 발췌근거·항목폐기·패턴우선·킬스위치·미분류폴백·예산상한 passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
