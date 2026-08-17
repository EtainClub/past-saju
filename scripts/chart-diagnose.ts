import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { calculateFourPillars, type DayBoundary } from "manseryeok";
import { DEFAULT_PROFILE } from "../src/lib/chart/profile";
import type { BirthInput } from "../src/lib/reading-types";
import { resolveSolarBirthDate } from "../src/lib/birth-date";

/**
 * 골든 불일치 원인 분리기.
 *
 * 불일치가 **우리 코드 버그**인지 **만세력 설정 차이**인지 가른다.
 * 각 케이스를 여러 변형으로 계산해, 사람이 적은 값과 일치하는 변형을 찾는다.
 * 특정 변형이 일관되게 맞으면 그건 설정 차이지 버그가 아니다.
 */

const CASES_PATH = resolve(__dirname, "../../tests/golden/chart.cases.json");
const SEOUL = 126.978;

type Pillars = { year: string; month: string; day: string; hour: string };
type GoldenCase = { id: string; group: string; input: BirthInput; expected: Pillars; engineOutput: Pillars };

type Variant = {
  label: string;
  trueSolar: boolean;
  eot: boolean;
  dayBoundary: DayBoundary;
  /** 음력 입력을 양력으로 취급 (만세력에 양력으로 넣은 경우) */
  treatLunarAsSolar: boolean;
};

/** 유파·설정 축을 교차해 만든 전체 조합. 하나가 전부를 설명하면 그게 만세력의 설정이다. */
const VARIANTS: Variant[] = [];
for (const trueSolar of [true, false]) {
  for (const eot of trueSolar ? [true, false] : [false]) {
    for (const dayBoundary of ["splitJasi", "jasi"] as const) {
      for (const treatLunarAsSolar of [false, true]) {
        VARIANTS.push({
          label: [
            trueSolar ? (eot ? "진태양시(균시차O)" : "진태양시(균시차X)") : "진태양시 없음",
            dayBoundary === "splitJasi" ? "야자시설" : "자시설",
            treatLunarAsSolar ? "음력→양력오입력" : "음력정상",
          ].join(" · "),
          trueSolar, eot, dayBoundary, treatLunarAsSolar,
        });
      }
    }
  }
}
/** 현재 우리 설정 — 프로파일을 따라간다. 프로파일이 바뀌면 기준선도 같이 바뀐다. */
const CURRENT = VARIANTS.find((v) =>
  v.trueSolar
  && v.eot === DEFAULT_PROFILE.applyEquationOfTime
  && v.dayBoundary === DEFAULT_PROFILE.dayBoundary
  && !v.treatLunarAsSolar)!;

function compute(input: BirthInput, variant: Variant): Pillars {
  const solar = variant.treatLunarAsSolar
    ? (() => {
        const [y, m, d] = input.date.split("-").map(Number);
        return { year: y, month: m, day: d };
      })()
    : resolveSolarBirthDate(input);
  if (!solar) throw new Error(`날짜 해석 실패: ${input.date}`);
  const [hour, minute] = input.timeUnknown || !input.time ? [12, 0] : input.time.split(":").map(Number);
  return calculateFourPillars({
    year: solar.year, month: solar.month, day: solar.day, hour, minute,
    gender: input.gender === "남성" ? "male" : input.gender === "여성" ? "female" : undefined,
    dayBoundary: variant.dayBoundary,
    ...(variant.trueSolar
      ? { trueSolarTime: { longitude: SEOUL, applyEquationOfTime: variant.eot, applyHistoricalDst: true } }
      : {}),
  }).toObject();
}

function diffKeys(a: Pillars, b: Pillars, input: BirthInput) {
  const keys = input.timeUnknown ? (["year", "month", "day"] as const) : (["year", "month", "day", "hour"] as const);
  return keys.filter((key) => a[key] !== b[key]);
}

const STEMS = "갑을병정무기경신임계";
const BRANCHES = "자축인묘진사오미신유술해";
/** 사람이 적은 값이 실재하는 간지인지. 오타는 유파 차이로 오인되기 쉽다. */
function invalidGanji(value: string): boolean {
  return value.trim().length > 0 && !(value.length === 2 && STEMS.includes(value[0]) && BRANCHES.includes(value[1]));
}

const cases = JSON.parse(readFileSync(CASES_PATH, "utf8")) as GoldenCase[];
const filled = cases.filter((item) => Object.values(item.expected).some((value) => value.trim()));

console.log(`불일치 원인 분리 — 기입된 ${filled.length}건 대상\n`);

// 0단계: 오타 걸러내기. 유효하지 않은 간지는 유파 차이로 오인되기 쉽다.
const typos: string[] = [];
for (const item of filled) {
  for (const [key, value] of Object.entries(item.expected)) {
    if (invalidGanji(value)) typos.push(`${item.id} ${key}: "${value}" — 실재하지 않는 간지`);
  }
}
if (typos.length) {
  console.log(`⌨ 오탈자로 보이는 기입 ${typos.length}건 (유파 판정에서 제외):`);
  for (const line of typos) console.log(`  ${line}`);
  console.log();
}

const scored = filled.filter((item) => !Object.values(item.expected).some(invalidGanji));

for (const item of scored) {
  const keys = diffKeys(compute(item.input, CURRENT), item.expected, item.input);
  if (keys.length === 0) continue;
  const matching = VARIANTS.filter((v) => diffKeys(compute(item.input, v), item.expected, item.input).length === 0);
  console.log(`${item.id.padEnd(20)} [${item.group}] ${keys.join(",")} → ${matching.length ? `${matching.length}개 조합이 설명` : "설명 안 됨"}`);
}

// 1단계: 기입된 전부를 한 조합이 설명하는가. 그렇다면 그것이 만세력의 설정이다.
console.log("\n=== 조합별 적중 (기입 전체 대비) ===");
const ranked = VARIANTS
  .map((variant) => ({
    variant,
    hits: scored.filter((item) => diffKeys(compute(item.input, variant), item.expected, item.input).length === 0).length,
  }))
  .sort((a, b) => b.hits - a.hits);

for (const { variant, hits } of ranked.slice(0, 5)) {
  const mark = variant === CURRENT ? "  ← 현재 우리 설정" : "";
  console.log(`  ${String(hits).padStart(3)}/${scored.length}  ${variant.label}${mark}`);
}

const best = ranked[0];
console.log();
if (best.hits === scored.length) {
  console.log(`✅ 단일 조합이 기입 전체를 설명합니다 — "${best.variant.label}"`);
  console.log("   엔진 버그가 아니라 설정 차이입니다.");
} else {
  const leftover = scored.filter((item) => diffKeys(compute(item.input, best.variant), item.expected, item.input).length > 0);
  console.log(`⚠ 최선 조합("${best.variant.label}")으로도 ${leftover.length}건이 남습니다 — 버그 후보:`);
  for (const item of leftover) {
    const got = compute(item.input, best.variant);
    const keys = diffKeys(got, item.expected, item.input);
    console.log(`  ${item.id} [${item.group}] ${keys.map((k) => `${k}: 만세력 ${item.expected[k]} ≠ 조합 ${got[k]}`).join(", ")}`);
  }
}
