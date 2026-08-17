import { strict as assert } from "node:assert";
import { summarizeChart } from "../src/lib/chart/summary";
import { createReadingSession } from "../src/lib/reading-engine";
import { DEFAULT_PROFILE } from "../src/lib/chart/profile";
import type { BirthInput, ReadingInput } from "../src/lib/reading-types";

/**
 * 「내 사주」 화면 검증.
 *
 * 핵심은 **서사와 같은 값**을 내는가다. 명식 화면과 결과의 근거란이 다른
 * 기둥을 보여 주면 둘 중 하나는 거짓이고, 사용자는 그걸 바로 알아챈다.
 */

function birth(overrides: Partial<BirthInput> = {}): BirthInput {
  return {
    date: "1988-03-02", time: "14:20", timeUnknown: false,
    calendarType: "solar", lunarLeapMonth: false, city: "부산", gender: "남성",
    ...overrides,
  };
}

function reading(b: BirthInput): ReadingInput {
  return {
    birth: b,
    event: { category: "이직", date: "2019-04", story: "회사를 옮길지 고민했습니다.", outcome: "남았습니다.", alternative: "" },
    context: { readiness: 3, freedom: 3, fear: 3 },
  };
}

// ── 1. 서사 근거란과 기둥이 일치하는가 ──────────────────────────────────
for (const b of [birth(), birth({ gender: "여성", city: "서울" }), birth({ date: "1975-11-08", time: "05:40" })]) {
  const summary = summarizeChart(b);
  const session = createReadingSession(reading(b));
  const basisPillars = session.choices[0].result.basis.pillars;
  for (const pillar of summary.pillars) {
    assert.equal(
      basisPillars.includes(pillar.korean),
      true,
      `근거란에 없는 기둥: ${pillar.label} ${pillar.korean} / 근거란=${basisPillars}`,
    );
  }
}

// ── 2. 시간 미상이면 시주를 보여 주지 않는다 ────────────────────────────
// 엔진이 정오를 임의 대입하므로(§6-6) 그 값을 화면에 내면 거짓이 된다.
const unknown = summarizeChart(birth({ time: "", timeUnknown: true }));
assert.equal(unknown.timeUnknown, true);
assert.equal(unknown.pillars.length, 3, "시간 미상인데 시주가 보인다");
assert.equal(unknown.pillars.every((p) => p.label !== "시주"), true, "시주가 섞여 있다");
// 오행도 6글자만 센다(4기둥 8글자가 아니라).
assert.equal(unknown.elements.reduce((sum, e) => sum + e.count, 0), 6, "시간 미상 오행 합계는 6이어야 한다");

const known = summarizeChart(birth());
assert.equal(known.pillars.length, 4);
assert.equal(known.elements.reduce((sum, e) => sum + e.count, 0), 8, "시간 있으면 오행 합계는 8");

// ── 3. 일주는 십신이 없다 ('나' 자신) ───────────────────────────────────
const day = known.pillars.find((p) => p.label === "일주")!;
assert.equal(day.stemTenGod, null, "일간에 십신이 붙었다 — 나 자신에게는 십신이 없다");

// ── 4. 성별 미입력이면 대운 대신 이유를 준다 ────────────────────────────
// 조용히 비면 고장으로 보인다.
const noGender = summarizeChart(birth({ gender: "응답 안 함" }));
assert.equal(noGender.luck.available, false);
assert.equal(typeof noGender.luck.reason, "string");
assert.equal((noGender.luck.reason ?? "").length > 10, true, "대운 없는 이유가 비었다");
assert.equal(summarizeChart(birth()).luck.available, true, "성별이 있으면 대운이 나와야 한다");

// ── 5. 신강 판정이 서사 엔진과 같은가 ───────────────────────────────────
// 같은 점수식·같은 임계를 써야 한다. 두 곳이 갈리면 근거란과 명식이 어긋난다.
for (const b of [birth(), birth({ date: "1991-07-15", time: "09:30", gender: "여성" })]) {
  const summary = summarizeChart(b);
  const basis = createReadingSession(reading(b)).choices[0].result.basis.strength;
  assert.equal(basis.includes(summary.strength.band), true, `신강 판정 불일치: ${summary.strength.band} vs ${basis}`);
}

// ── 6. 유파 프로파일이 같은가 ───────────────────────────────────────────
assert.equal(summarizeChart(birth()).profileId, DEFAULT_PROFILE.id);

// ── 7. 결정론 ───────────────────────────────────────────────────────────
// 같은 날 두 번 부르면 같아야 한다. 대운 '지금' 표시는 날짜를 고정해 비교한다.
const fixed = new Date("2026-08-17T00:00:00+09:00");
assert.deepEqual(summarizeChart(birth(), fixed), summarizeChart(birth(), fixed), "같은 입력이 다른 결과를 냈다");

// ── 8. 현재 대운이 하나만 표시되는가 ────────────────────────────────────
const current = summarizeChart(birth(), fixed).luck.pillars.filter((p) => p.current);
assert.equal(current.length <= 1, true, `'지금'이 ${current.length}개 표시됐다`);

console.log("chart summary fixtures: 근거란일치·시간미상·일간십신·대운부재사유·신강일치·프로파일·결정론 passed");
