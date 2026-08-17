import { createHash } from "node:crypto";
import { strict as assert } from "node:assert";
import { createReadingSession } from "../src/lib/reading-engine";
import { classifySafety } from "../src/lib/safety";
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
      story: "오랫동안 다닌 회사를 떠날 기회가 있었지만 안정을 선택해 남았습니다.",
      outcome: "결국 남았고 일은 익숙해졌습니다.",
      alternative: "그때 떠났다면 어땠을지 생각했습니다.",
      ...overrides.event,
    },
    context: { readiness: 3, freedom: 4, fear: 4, ...overrides.context },
  };
}

function fingerprint(input: ReadingInput) {
  return createReadingSession(input).choices
    .map((choice) => ({
      axis: choice.axis,
      pillars: choice.result.basis.pillars,
      points: choice.result.timeline.map((item) => item.month),
      commonFate: choice.result.commonFate,
    }))
    .sort((a, b) => a.axis.localeCompare(b.axis));
}

assert.deepEqual(fingerprint(fixture()), fingerprint(fixture()), "동일 입력은 같은 명세를 만들어야 합니다.");
const lunarEquivalent = fixture({ birth: { ...fixture().birth, date: "1991-06-04", calendarType: "lunar", lunarLeapMonth: false } });
assert.deepEqual(fingerprint(fixture()), fingerprint(lunarEquivalent), "같은 생일의 양력·음력 입력은 같은 명세를 만들어야 합니다.");

const sample = createReadingSession(fixture());
assert.equal(new Set(sample.choices.map((choice) => choice.axis)).size, 3, "세 카드는 서로 다른 십신 축이어야 합니다.");
for (const choice of sample.choices) {
  const months = choice.result.timeline.map((item) => item.month);
  const specMonths = choice.narrativeSpec.turningPoints.map((item) => item.monthOffset);
  assert(months[0] >= 1 && months[0] <= 6, "초기 전환점이 1~6개월에 있어야 합니다.");
  assert(months[1] >= 7 && months[1] <= 15, "1년 전환점이 7~15개월에 있어야 합니다.");
  assert(months[2] >= 27 && months[2] <= 36, "3년 전환점이 27~36개월에 있어야 합니다.");
  assert(specMonths[0] >= 1 && specMonths[0] <= 6 && specMonths[1] >= 7 && specMonths[1] <= 15 && specMonths[2] >= 16 && specMonths[2] <= 26 && specMonths[3] >= 27 && specMonths[3] <= 36, "명세는 36개월을 네 구간으로 나눠야 합니다.");
  assert(choice.result.overview.some((paragraph) => paragraph.includes(choice.narrativeSpec.primaryDomain)), "주요 도메인이 서사에 보여야 합니다.");
  assert(choice.result.commonFate.includes(choice.narrativeSpec.invariantTheme.statement), "불변 주제가 공통 운명에 보여야 합니다.");
  assert.equal(choice.result.basis.turningPointsUsed.length, 4, "근거에는 네 전환점을 모두 공개해야 합니다.");
  assert.match(choice.result.basis.usefulFlow, /용신 축 .*기신 축/, "용신·기신 축을 근거에 공개해야 합니다.");
  assert(choice.narrativeSpec.confidence.overall > 0 && choice.narrativeSpec.confidence.overall <= 1, "신뢰도는 0~1 범위여야 합니다.");
  const commitment = createHash("sha256")
    .update(`${sample.id}|${choice.id}|${choice.text}|${choice.nonce}`)
    .digest("hex");
  assert.equal(commitment, choice.commitment, "카드 커밋먼트를 재계산할 수 있어야 합니다.");
}

const unknownHour = createReadingSession(fixture({ birth: { ...fixture().birth, time: "", timeUnknown: true } }));
for (const choice of unknownHour.choices) {
  assert.equal(choice.narrativeSpec.confidence.hourPillar, "unknown");
  assert.match(choice.result.basis.pillars, /시주 미반영$/, "시간 미상일 때 임의의 시주를 표시하면 안 됩니다.");
}
const sessionCommitment = createHash("sha256").update([...sample.choiceCommitments].sort().join("|")).digest("hex");
assert.equal(sessionCommitment, sample.sessionCommitment, "세션 커밋먼트를 재계산할 수 있어야 합니다.");

assert.equal(classifySafety(fixture({ event: { ...fixture().event, story: "가까운 사람의 사망 이후 내 선택을 계속 탓하고 있습니다." } })), true);
assert.equal(classifySafety(fixture()), false);

for (let index = 0; index < 30; index += 1) {
  const year = 1965 + index;
  const month = String((index % 12) + 1).padStart(2, "0");
  const day = String((index % 20) + 5).padStart(2, "0");
  const hour = String((index * 3) % 24).padStart(2, "0");
  const session = createReadingSession(fixture({
    birth: { ...fixture().birth, date: `${year}-${month}-${day}`, time: `${hour}:20`, city: index % 2 ? "부산" : "서울" },
  }));
  assert.equal(session.choices.length, 3);
  assert.equal(session.choices[0].result.basis.pillars.split(" · ").length, 4);
  assert.equal(session.choices[0].result.timeline.length, 3);
}

const divergent = new Set<string>();
for (let day = 10; day < 20; day += 1) {
  const reading = fingerprint(fixture({ birth: { ...fixture().birth, date: `1991-07-${day}` } }));
  divergent.add(JSON.stringify(reading.map(({ axis, pillars, points }) => ({ axis, pillars, points }))));
}
assert(divergent.size >= 8, "생년월일 변화가 서사 명세에 충분히 각인되어야 합니다.");

console.log("engine fixtures: 30 natal profiles + determinism, divergence, safety, sealing passed");
