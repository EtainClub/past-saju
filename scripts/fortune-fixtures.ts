import { strict as assert } from "node:assert";
import { isValidFortuneDate, seoulToday, todayFortune } from "../src/lib/fortune/today";
import { summarizeChart } from "../src/lib/chart/summary";
import { createReadingSession } from "../src/lib/reading-engine";
import type { BirthInput, ReadingInput } from "../src/lib/reading-types";

/**
 * 「오늘의 운세」 검증.
 *
 * 이 화면은 LLM 이 없으므로 **말한 것을 전부 검사할 수 있다.** 픽스처가 지키는 것:
 *   · 같은 사람·같은 날이면 같은 결과 (결정론 — 캐시 없이도 말이 안 바뀐다)
 *   · 점수가 정해진 범위를 벗어나지 않고, 밴드·별점이 점수와 어긋나지 않는다
 *   · 충이 들었는데 주의사항이 비는 일이 없다
 *   · 시간 미상이면 시지를 근거로 쓰지 않는다
 *   · 용신·기신 판정이 「내 사주」·「이야기」와 같다
 */

function birth(overrides: Partial<BirthInput> = {}): BirthInput {
  return {
    date: "1988-03-02", time: "14:20", timeUnknown: false,
    calendarType: "solar", lunarLeapMonth: false, city: "부산", gender: "남성",
    ...overrides,
  };
}

// 60갑자 한 바퀴. 일진 60종을 모두 지나므로 특정 간지에서만 나는 문제도 걸린다.
const DATES = Array.from({ length: 60 }, (_, index) =>
  new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10));

const PEOPLE = [
  birth(),
  birth({ gender: "여성", city: "서울" }),
  birth({ gender: "응답 안 함" }),
  birth({ date: "1975-11-08", time: "05:40" }),
  birth({ date: "1999-07-21", time: "", timeUnknown: true }),
  birth({ date: "2001-01-30", calendarType: "lunar", time: "23:30" }),
];

// ── 1. 결정론 ───────────────────────────────────────────────────────────
// 같은 날 두 번 열면 같은 말이 나와야 한다. 이게 성립해야 캐시가 필요 없다.
for (const person of PEOPLE) {
  const first = todayFortune(person, "2026-08-18");
  const second = todayFortune(person, "2026-08-18");
  assert.deepEqual(first, second, "같은 입력에 다른 결과가 나왔다");
}

// ── 2. 점수·밴드·별점의 일관성 ──────────────────────────────────────────
for (const person of PEOPLE) {
  for (const date of DATES) {
    const fortune = todayFortune(person, date);
    for (const item of [fortune.overall, ...fortune.domains]) {
      assert.equal(Number.isInteger(item.score), true, `정수가 아닌 점수: ${item.score}`);
      assert.equal(item.score >= 5 && item.score <= 95, true, `범위를 벗어난 점수: ${item.score}`);
      assert.equal(item.stars >= 1 && item.stars <= 5, true, `범위를 벗어난 별점: ${item.stars}`);
      // 밴드와 점수가 어긋나면 화면이 "조심"이라 쓰고 90점을 그린다.
      const expected = item.score >= 72 ? "아주 좋음" : item.score >= 58 ? "좋음" : item.score >= 44 ? "무난" : "조심";
      assert.equal(item.band, expected, `${item.score}점인데 밴드가 ${item.band}`);
      assert.equal(item.headline.length > 0 && item.detail.length > 0, true, "빈 문구");
    }
    assert.deepEqual(fortune.domains.map((item) => item.domain), ["애정", "재물", "성취"]);
  }
}

// ── 3. 주의사항은 항상 있고, 근거 없이 늘어나지 않는다 ──────────────────
for (const person of PEOPLE) {
  for (const date of DATES) {
    const fortune = todayFortune(person, date);
    assert.equal(fortune.cautions.length >= 1 && fortune.cautions.length <= 3, true, `주의사항 개수: ${fortune.cautions.length}`);
    assert.equal(new Set(fortune.cautions).size, fortune.cautions.length, "주의사항이 중복됐다");
    // 충이 들었는데 아무 말이 없으면 이 화면은 거짓말을 하는 것이다.
    const clash = fortune.hits.find((hit) => hit.relation === "충");
    if (clash) {
      assert.equal(
        fortune.cautions.some((line) => line.includes(clash.palace) && line.includes("충")),
        true,
        `${date}: 충(${clash.palace})이 들었는데 주의사항에 없다`,
      );
    }
  }
}

// ── 4. 시간 미상이면 시지를 쓰지 않는다 ─────────────────────────────────
// 엔진이 정오를 임의 대입한 시주를 근거로 쓰면 없는 사실을 말하는 셈이 된다.
for (const date of DATES) {
  const fortune = todayFortune(birth({ time: "", timeUnknown: true }), date);
  assert.equal(fortune.timeUnknown, true);
  assert.equal(fortune.hits.every((hit) => hit.palace !== "시지"), true, `${date}: 시간 미상인데 시지를 근거로 썼다`);
}

// ── 5. 용신·기신 판정이 다른 화면과 같은가 ──────────────────────────────
// 세 화면이 같은 사람을 두고 다른 용신을 말하면 어느 하나는 거짓이다.
for (const person of PEOPLE) {
  const fortune = todayFortune(person, "2026-08-18");
  const summary = summarizeChart(person, new Date("2026-08-18T03:00:00Z"));
  const summaryUseful = summary.bridge.axes.filter((axis) => axis.role === "용신").map((axis) => axis.axis);
  const summaryHostile = summary.bridge.axes.filter((axis) => axis.role === "기신").map((axis) => axis.axis);
  for (const role of [fortune.incoming.stemRole, fortune.incoming.branchRole]) {
    assert.equal(["용신", "기신", "중립"].includes(role), true, `알 수 없는 역할: ${role}`);
  }
  assert.equal(summaryUseful.includes(fortune.incoming.stemAxis) === (fortune.incoming.stemRole === "용신"), true,
    "내 사주와 오늘의 운세가 서로 다른 용신을 말한다");
  assert.equal(summaryHostile.includes(fortune.incoming.branchAxis) === (fortune.incoming.branchRole === "기신"), true,
    "내 사주와 오늘의 운세가 서로 다른 기신을 말한다");

  // 서사(이야기 탭)의 근거란과도 같아야 한다.
  const reading: ReadingInput = {
    birth: person,
    event: { category: "이직", date: "2019-04", story: "회사를 옮길지 고민했습니다.", outcome: "남았습니다.", alternative: "" },
    context: { readiness: 3, freedom: 3, fear: 3 },
  };
  const basis = createReadingSession(reading).choices[0].result.basis.usefulFlow;
  for (const axis of summaryUseful) {
    assert.equal(basis.includes(axis), true, `서사 근거란에 없는 용신 축: ${axis} / ${basis}`);
  }
}

// ── 6. 같은 날이라도 사람마다 다르고, 같은 사람이라도 날마다 달라야 한다 ─
// 하나의 값만 나오면 계산이 아니라 상수를 보여 주고 있는 것이다.
const acrossDays = new Set(DATES.map((date) => todayFortune(birth(), date).overall.score));
assert.equal(acrossDays.size >= 10, true, `날짜에 따른 총운 변화가 너무 적다: ${acrossDays.size}종`);
const acrossPeople = new Set(PEOPLE.map((person) => todayFortune(person, "2026-08-18").overall.score));
assert.equal(acrossPeople.size >= 3, true, `사람에 따른 총운 변화가 너무 적다: ${acrossPeople.size}종`);

// 애정 축은 성별 관습을 따른다 — 남성 재성, 여성 관성. 미입력이면 둘 다 본다.
const male = todayFortune(birth({ gender: "남성" }), "2026-08-18");
const female = todayFortune(birth({ gender: "여성" }), "2026-08-18");
assert.notEqual(
  male.domains.find((item) => item.domain === "애정")!.score,
  female.domains.find((item) => item.domain === "애정")!.score,
  "성별이 달라도 애정 점수가 같다 — 축 선택이 안 먹었다",
);

// ── 7. 날짜 처리 ────────────────────────────────────────────────────────
assert.equal(isValidFortuneDate("2026-08-18"), true);
assert.equal(isValidFortuneDate("2026-02-30"), false, "없는 날짜를 통과시켰다");
assert.equal(isValidFortuneDate("2026-8-18"), false, "형식이 다른 날짜를 통과시켰다");
assert.equal(isValidFortuneDate("오늘"), false);
assert.throws(() => todayFortune(birth(), "2026-02-30"), /유효하지 않은 날짜/);
assert.match(seoulToday(), /^\d{4}-\d{2}-\d{2}$/);
// KST 기준이어야 한다 — UTC 로 세면 한국의 자정~오전 9시 사이에 어제가 나온다.
assert.equal(seoulToday(new Date("2026-08-17T15:30:00Z")), "2026-08-18", "서울 시각으로 세지 않았다");
assert.equal(seoulToday(new Date("2026-08-17T14:30:00Z")), "2026-08-17");

// ── 8. 일진은 만세력과 같은 값인가 ──────────────────────────────────────
// 2026-08-18 은 갑자일이다(기준 만세력 대조). 일진이 틀리면 나머지가 전부 틀린다.
assert.equal(todayFortune(birth(), "2026-08-18").dayGanji.korean, "갑자");
assert.equal(todayFortune(birth(), "2026-08-19").dayGanji.korean, "을축");

console.log("fortune fixtures: 결정론·점수범위·주의사항·시간미상·용신일치·변화폭·날짜·일진 passed");
