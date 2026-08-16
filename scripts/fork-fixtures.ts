import { strict as assert } from "node:assert";
import { calculateFourPillars } from "manseryeok";
import { createReadingSession } from "../src/lib/reading-engine";
import { classifyFork } from "../src/lib/fork/classify";
import { forkBias, BIAS_CAP } from "../src/lib/fork/bias";
import { BIAS, DOMAINS } from "../src/lib/fork/ontology";
import { axisFromTenGod } from "../src/lib/ten-god-axis";
import type { ForkKey } from "../src/lib/fork/types";
import type { ReadingInput } from "../src/lib/reading-types";

function fixture(overrides: Partial<ReadingInput> = {}): ReadingInput {
  return {
    birth: {
      date: "1991-07-15",
      calendarType: "solar",
      lunarLeapMonth: false,
      time: "09:30",
      timeUnknown: false,
      city: "서울",
      gender: "여성",
      ...overrides.birth,
    },
    event: {
      category: "이직",
      date: "2021-09",
      story: "같은 고민을 오래 붙잡고 있었습니다.",
      outcome: "",
      alternative: "",
      ...overrides.event,
    },
    context: { readiness: 3, freedom: 4, fear: 4, ...overrides.context },
  };
}

function withEvent(event: Partial<ReadingInput["event"]>) {
  return fixture({ event: { ...fixture().event, ...event } });
}

function classified(input: ReadingInput): ForkKey {
  const result = classifyFork(input);
  assert.equal(result.status, "CLASSIFIED", `분류 실패: ${JSON.stringify(result)}`);
  return (result as { status: "CLASSIFIED"; frame: { key: ForkKey } }).frame.key;
}

// ── 1. 극성 판정 ────────────────────────────────────────────────────────────
{
  const leave = classified(withEvent({ outcome: "결국 퇴사했습니다." }));
  assert.equal(leave.domain, "CAREER");
  assert.equal(leave.actualChoice, "LEAVE");
  assert.equal(leave.counterfactual, "STAY", "가지 않은 극은 실제 선택의 반대여야 합니다.");

  const stay = classified(withEvent({ outcome: "결국 남았습니다." }));
  assert.equal(stay.actualChoice, "STAY");
  assert.equal(stay.counterfactual, "LEAVE");
}

// ── 2. alternative는 가지 않은 쪽이므로 극을 뒤집어 집계한다 ──────────────────
{
  const key = classified(withEvent({ story: "오래 고민만 했습니다.", alternative: "그때 퇴사했다면 어땠을까 생각합니다." }));
  assert.equal(key.actualChoice, "STAY", "alternative의 '퇴사'는 실제로는 남았다는 뜻입니다.");
  assert.equal(key.counterfactual, "LEAVE");
}

// ── 3. 도메인은 카테고리 힌트 + 본문 패턴으로 정한다 ─────────────────────────
{
  const cases: Array<[Partial<ReadingInput["event"]>, string, string]> = [
    [{ category: "연애", outcome: "결국 헤어졌습니다." }, "RELATION", "SEPARATE"],
    [{ category: "창업", outcome: "회사를 차렸습니다." }, "VENTURE", "EXPAND"],
    [{ category: "진학", outcome: "대학원에 진학했습니다." }, "STUDY", "EXPAND"],
    [{ category: "이사", outcome: "결국 이사했습니다." }, "MOVE", "LEAVE"],
    [{ category: "투자", outcome: "그때 집을 샀습니다." }, "WEALTH", "EXPAND"],
    [{ category: "기타", outcome: "휴직하고 쉬기로 했습니다." }, "HEALTH", "CONTRACT"],
  ];
  for (const [event, domain, pole] of cases) {
    const key = classified(withEvent(event));
    assert.equal(key.domain, domain, `${event.outcome} → ${domain} 이어야 합니다.`);
    assert.equal(key.actualChoice, pole);
  }
}

// ── 4. 판정이 서지 않으면 UNKNOWN. 임의 기본값을 만들지 않는다 ────────────────
{
  const noSignal = classifyFork(withEvent({ story: "그 무렵의 일을 자주 떠올립니다.", outcome: "", alternative: "" }));
  assert.equal(noSignal.status, "UNKNOWN", "극성 근거가 없으면 카테고리만으로 확정하면 안 됩니다.");
  assert.equal((noSignal as { reason: string }).reason, "no-polarity-signal");

  const tie = classifyFork(withEvent({ story: "퇴사를 고민했지만 남았습니다.", outcome: "", alternative: "" }));
  assert.equal(tie.status, "UNKNOWN", "양쪽 근거가 같으면 UNKNOWN 이어야 합니다.");
  assert.equal((tie as { reason: string }).reason, "polarity-tie");
}

// ── 5. 결정론 ───────────────────────────────────────────────────────────────
{
  const input = withEvent({ outcome: "결국 퇴사했습니다." });
  const first = JSON.stringify(classifyFork(input));
  for (let index = 0; index < 50; index += 1) {
    assert.equal(JSON.stringify(classifyFork(input)), first, "동일 입력은 동일 분류를 내야 합니다.");
  }
}

// ── 6. intensity는 readiness + freedom에서 나온다 (readiness 미사용 해소) ─────
{
  const low = classified(fixture({ event: { ...withEvent({ outcome: "결국 퇴사했습니다." }).event }, context: { readiness: 1, freedom: 2, fear: 3 } }));
  const high = classified(fixture({ event: { ...withEvent({ outcome: "결국 퇴사했습니다." }).event }, context: { readiness: 5, freedom: 5, fear: 3 } }));
  assert.equal(low.intensity, 1);
  assert.equal(high.intensity, 3);
}

// ── 7. ★ 게이트: 갈림길이 다르면 카드 축이 달라진다 ──────────────────────────
{
  const axesFor = (event: Partial<ReadingInput["event"]>) =>
    createReadingSession(withEvent(event)).choices.map((choice) => choice.axis).sort().join("·");

  const leaveAxes = axesFor({ outcome: "결국 퇴사했습니다." });
  const stayAxes = axesFor({ outcome: "결국 남았습니다." });
  assert.notEqual(leaveAxes, stayAxes, "같은 명식이라도 갈림길이 반대면 축 집합이 달라져야 합니다.");

  // 축 집합은 5축 중 상위 3축이라 편향(≤1.8)이 3위·4위 격차를 넘지 못하면 그대로다.
  // 측정값 6/10. 이 수치는 회귀 방지 하한이며, 나머지 4할까지 서사를 가르는 일은
  // L5(A4)의 몫이다 — docs/WORLDMODEL.md §5 Track A.
  let differing = 0;
  for (let day = 10; day < 20; day += 1) {
    const birth = { ...fixture().birth, date: `1991-07-${day}` };
    const leave = createReadingSession(fixture({ birth, event: { ...withEvent({ outcome: "결국 퇴사했습니다." }).event } }));
    const stay = createReadingSession(fixture({ birth, event: { ...withEvent({ outcome: "결국 남았습니다." }).event } }));
    const key = (session: ReturnType<typeof createReadingSession>) => session.choices.map((c) => c.axis).sort().join("·");
    if (key(leave) !== key(stay)) differing += 1;
  }
  assert(differing >= 6, `갈림길이 축 집합에 충분히 각인되어야 합니다 (10건 중 ${differing}건)`);

  // 축 집합이 같아도 근거란의 갈림길 판정은 항상 갈려야 한다.
  for (let day = 10; day < 20; day += 1) {
    const birth = { ...fixture().birth, date: `1991-07-${day}` };
    const flow = (outcome: string) =>
      createReadingSession(fixture({ birth, event: { ...withEvent({ outcome }).event } })).choices[0].result.basis.eventFlow;
    assert.notEqual(flow("결국 퇴사했습니다."), flow("결국 남았습니다."), `${day}일생의 근거란이 갈림길에 반응하지 않습니다.`);
  }
}

// ── 8. 경계: 용신·기신은 갈림길이 바꾸지 않는다 (L1/L2 분리) ──────────────────
{
  const usefulFlow = (event: Partial<ReadingInput["event"]>) =>
    createReadingSession(withEvent(event)).choices[0].result.basis.usefulFlow;
  assert.equal(
    usefulFlow({ outcome: "결국 퇴사했습니다." }),
    usefulFlow({ outcome: "결국 남았습니다." }),
    "용신·기신은 명식 판정이므로 갈림길에 반응하면 안 됩니다.",
  );
}

// ── 9. 관계 축은 일지에서 나오고 성별에 무관하다 (§7-4 결정) ──────────────────
{
  const chartFor = (gender?: "male" | "female") =>
    calculateFourPillars({ year: 1991, month: 7, day: 15, hour: 9, minute: 30, gender, dayBoundary: "jasi" });
  const key: ForkKey = {
    domain: "RELATION",
    polarityAxis: "JOIN_SEPARATE",
    actualChoice: "SEPARATE",
    counterfactual: "JOIN",
    intensity: 2,
    timepoint: { year: 2021, month: 9 },
    confidence: 1,
    source: "pattern",
  };
  const male = forkBias(key, chartFor("male"));
  const female = forkBias(key, chartFor("female"));
  const unspecified = forkBias(key, chartFor(undefined));
  assert.deepEqual(male, female, "관계 축이 성별에 따라 갈리면 안 됩니다.");
  assert.deepEqual(male, unspecified, "성별 미입력에서도 동일해야 합니다.");
  assert.deepEqual(Object.keys(male), [axisFromTenGod(chartFor("male").tenGods.day.branch)], "관계 축은 일지의 십신이어야 합니다.");
  assert(!BIAS["RELATION:JOIN"] && !BIAS["RELATION:SEPARATE"], "RELATION은 고정 BIAS 항목을 두지 않습니다.");
  assert.equal(DOMAINS.RELATION.axis, "@일지");

  const opposite = forkBias({ ...key, actualChoice: "JOIN", counterfactual: "SEPARATE" }, chartFor("female"));
  assert.equal(Math.sign(Object.values(opposite)[0]), -Math.sign(Object.values(female)[0]), "반대 극은 부호가 뒤집혀야 합니다.");
}

// ── 10. 편향은 대운 가중치를 넘지 않는다 ─────────────────────────────────────
{
  const chart = calculateFourPillars({ year: 1991, month: 7, day: 15, hour: 9, minute: 30, gender: "female", dayBoundary: "jasi" });
  for (const domain of Object.keys(DOMAINS) as Array<keyof typeof DOMAINS>) {
    for (const counterfactual of ["LEAVE", "STAY", "EXPAND", "CONTRACT", "JOIN", "SEPARATE"] as const) {
      for (const intensity of [1, 2, 3] as const) {
        const bias = forkBias({
          domain, polarityAxis: DOMAINS[domain].polarityAxis, actualChoice: counterfactual,
          counterfactual, intensity, timepoint: { year: 2021, month: 9 }, confidence: 1, source: "pattern",
        }, chart);
        for (const value of Object.values(bias)) {
          assert(Math.abs(value) <= BIAS_CAP, `${domain}:${counterfactual} 편향이 상한(${BIAS_CAP})을 넘습니다: ${value}`);
        }
      }
    }
  }
}

// ── 11. 미분류여도 서사는 정상 생성된다 (폴백 = 현행 동작) ────────────────────
{
  const session = createReadingSession(withEvent({ story: "그 무렵의 일을 자주 떠올립니다.", outcome: "", alternative: "" }));
  assert.equal(session.choices.length, 3);
  assert.match(session.choices[0].result.basis.eventFlow, /확정하지 못해/, "미분류는 근거란에 밝혀야 합니다.");
}

// ── 12. 분류되면 근거란에 갈림길 판정을 공개한다 ─────────────────────────────
{
  const session = createReadingSession(withEvent({ outcome: "결국 퇴사했습니다." }));
  assert.match(session.choices[0].result.basis.eventFlow, /직업의 갈림길/);
  assert.match(session.choices[0].result.basis.eventFlow, /남는 쪽을 이 카드에 반영/);
}

console.log("fork fixtures: 분류·극성반전·UNKNOWN·결정론·축반응·경계분리·성별무관·상한 passed");
