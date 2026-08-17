import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { calculateFourPillars, getSolarTerm, SOLAR_TERM_NAMES } from "manseryeok";
import { DEFAULT_PROFILE } from "../src/lib/chart/profile";
import type { BirthInput } from "../src/lib/reading-types";
import { resolveSolarBirthDate } from "../src/lib/birth-date";

/**
 * L1 골든 테스트 — 명식 산출의 정답 대조.
 *
 * 이 서비스의 모든 층(L2 갈림길, L3 전환점, L4 세 갈래, L5 서사)이 명식 위에
 * 서 있다. 명식이 틀리면 **사용자는 절대 알아채지 못한다** — 서사는 여전히
 * 그럴듯하게 나오고 피드백도 긍정으로 돌아온다. 그래서 사람이 검증해야 한다.
 *
 * 사용법
 *   생성: node .test-dist/scripts/chart-golden.js --generate
 *   검증: node .test-dist/scripts/chart-golden.js
 *
 * 검증 절차 (사람)
 *   1. tests/golden/chart.cases.json 을 연다
 *   2. 각 케이스의 input 을 신뢰하는 만세력에 넣는다 (note 를 먼저 읽을 것)
 *   3. engineOutput 과 비교해, 맞으면 expected 에 그대로 옮겨 적고
 *      틀리면 만세력 값을 적는다
 *   4. 검증 파일을 다시 돌린다. expected 가 빈 케이스는 "미검증"으로 집계된다
 *
 * ⚠ 만세력 설정을 반드시 맞출 것 — 안 맞추면 전부 틀린 것처럼 나온다
 *   설정을 라벨이 아니라 **관측 가능한 동작**으로 적는다. "야자시 구분"처럼
 *   도구마다 뜻이 갈리는 용어가 1차 대조에서 실제로 오검증을 냈다.
 *
 *   · 진태양시 **적용**, 출생지 서울(경도 126.978°)
 *     끄고 비교하면 시주가 약 30분 어긋나 경계 케이스가 전부 불일치한다
 *   · 균시차(EoT)는 **적용하지 않는다** — 경도 보정만 (§7-11)
 *     확인법: 대부분의 국내 만세력이 기본값으로 안 쓴다. 별도 옵션이 있으면 끈다
 *   · 자시설 — **23:00~23:59 출생의 일주가 다음날로 넘어가야 한다** (§7-1)
 *     확인법: 1995-05-20 23:55 서울 남성 → 일주가 임자(壬子)면 자시설이 맞다.
 *     신해(辛亥)로 나오면 그 도구는 야자시설이라 이 골든과 맞지 않는다
 *   · 서머타임·과거 표준시 **자동 보정** (1954~61 +8:30, 1987~88 서머타임)
 *   · 음력 케이스는 note 의 **양력 환산일**을 넣는다. 음력 토글을 쓰지 말 것
 *   · 시간 미상 케이스는 시주를 비교하지 않는다(년·월·일만 채우면 된다)
 *
 * ⚠ engineOutput 은 **우리 엔진의 계산이며 검증 대상**이다. 그대로 복사하면
 *   테스트가 아무것도 보장하지 않는다. 반드시 외부 만세력과 대조할 것.
 *
 * 불일치가 나오면 scripts/chart-diagnose.ts 를 먼저 돌린다. 설정 차이인지
 * 엔진 버그인지 가려 준다 — 고치기 전에 원인부터 아는 게 순서다.
 */

const CASES_PATH = resolve(__dirname, "../../tests/golden/chart.cases.json");
const KST_OFFSET_MIN = 9 * 60;

type GoldenCase = {
  id: string;
  group: string;
  note: string;
  input: BirthInput;
  /** 사람이 만세력을 보고 채운다. 비어 있으면 미검증. */
  expected: { year: string; month: string; day: string; hour: string };
  /** 우리 엔진의 계산 — 검증 대상이지 정답이 아니다. */
  engineOutput: { year: string; month: string; day: string; hour: string };
};

function pillarsOf(input: BirthInput) {
  const solar = resolveSolarBirthDate(input);
  if (!solar) throw new Error(`유효하지 않은 생년월일: ${input.date}`);
  const [hour, minute] = input.timeUnknown || !input.time ? [12, 0] : input.time.split(":").map(Number);
  const chart = calculateFourPillars({
    year: solar.year, month: solar.month, day: solar.day, hour, minute,
    gender: input.gender === "남성" ? "male" : input.gender === "여성" ? "female" : undefined,
    dayBoundary: DEFAULT_PROFILE.dayBoundary,
    trueSolarTime: {
      longitude: 126.978,
      applyEquationOfTime: DEFAULT_PROFILE.applyEquationOfTime,
      applyHistoricalDst: true,
    },
  });
  return chart.toObject();
}

function birth(date: string, time: string, overrides: Partial<BirthInput> = {}): BirthInput {
  return {
    date, time, timeUnknown: false, calendarType: "solar", lunarLeapMonth: false,
    city: "서울", gender: "남성", ...overrides,
  };
}

/** 절입 절대 순간(UTC ms)을 한국 벽시계로 환산해 offset분 만큼 이동한다. */
function wallClockAround(instantMs: number, offsetMinutes: number) {
  const shifted = new Date(instantMs + (KST_OFFSET_MIN + offsetMinutes) * 60_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
  };
}

function buildCases(): Array<Omit<GoldenCase, "engineOutput">> {
  const cases: Array<Omit<GoldenCase, "engineOutput">> = [];
  const empty = { year: "", month: "", day: "", hour: "" };
  const add = (id: string, group: string, note: string, input: BirthInput) =>
    cases.push({ id, group, note, input, expected: { ...empty } });
  /**
   * 음력 케이스. note 에 양력 환산일을 박아, 사람이 만세력의 음력 토글을
   * 건드리지 않고 양력으로만 조회하게 한다. 토글을 잊는 실수가 유파 차이로
   * 오인되는 것을 막는다.
   */
  const addLunar = (id: string, group: string, note: string, input: BirthInput) => {
    const solar = resolveSolarBirthDate(input);
    if (!solar) throw new Error(`음력 환산 실패: ${input.date}`);
    const pad = (value: number) => String(value).padStart(2, "0");
    const solarDate = `${solar.year}-${pad(solar.month)}-${pad(solar.day)}`;
    add(id, group, `${note} → 만세력에는 **양력 ${solarDate}** 로 넣으세요 (음력 토글 쓰지 말 것)`, input);
  };

  // ── 입춘 전후 3건 — 연주 경계 ──────────────────────────────────────────
  const ipchun2000 = getSolarTerm(2000, 2).date.getTime();
  for (const [offset, label] of [[-10, "10분 전"], [10, "10분 후"], [-1440, "1일 전"]] as const) {
    const { date, time } = wallClockAround(ipchun2000, offset);
    add(`ipchun-2000-${offset}`, "입춘 경계", `2000년 입춘 절입 ${label} (연주가 갈립니다)`, birth(date, time));
  }

  // ── 각 절(節) 경계 12건 — 월주 경계 ────────────────────────────────────
  // 짝수 인덱스가 절(節)로 월의 시작을 정한다. 절입 5분 전이면 이전 월이어야 한다.
  for (let termIndex = 0; termIndex < 24; termIndex += 2) {
    const instant = getSolarTerm(1990, termIndex).date.getTime();
    const { date, time } = wallClockAround(instant, -5);
    add(
      `jeol-1990-${termIndex}`,
      "절 경계",
      `1990년 ${SOLAR_TERM_NAMES[termIndex]} 절입 5분 전 (월주가 이전 달이어야 합니다)`,
      birth(date, time),
    );
  }

  // ── 표준시 +8:30 구간 3건 (1954-03-21 ~ 1961-08-09) ────────────────────
  add("kst830-1957", "표준시 +8:30", "동경 127.5° 표준시 시행 중 — 시주가 30분 밀립니다", birth("1957-06-20", "12:00"));
  add("kst830-1960", "표준시 +8:30", "동경 127.5° 표준시 시행 중", birth("1960-01-15", "07:40", { gender: "여성" }));
  add("kst830-1955", "표준시 +8:30", "동경 127.5° 표준시 시행 중", birth("1955-09-03", "23:20"));

  // ── 서머타임 구간 3건 (1948~51, 1955~60, 1987~88) ──────────────────────
  add("dst-1987", "서머타임", "1987년 서머타임 — 시주가 1시간 밀립니다", birth("1987-07-15", "14:00"));
  add("dst-1988", "서머타임", "1988년 서머타임", birth("1988-08-10", "09:30", { gender: "여성" }));
  add("dst-1959", "서머타임", "1959년 서머타임 (+8:30 구간과 겹칩니다)", birth("1959-07-05", "16:20"));

  // ── 자시 경계 5건 — 프로파일(야자시설) 검증 ────────────────────────────
  for (const time of ["22:50", "23:05", "23:30", "23:55", "00:10"]) {
    add(
      `jasi-${time.replace(":", "")}`,
      "자시 경계",
      `자시설: 23시대 출생은 일주까지 다음날로 넘어갑니다 (프로파일 ${DEFAULT_PROFILE.dayBoundary})`,
      birth("1995-05-20", time),
    );
  }

  // ── 윤달 3건 ───────────────────────────────────────────────────────────
  // 음력 케이스는 note 에 양력 환산일을 함께 적는다. 사람이 만세력의 음력
  // 토글을 건드릴 일이 없어야 한다 — 그 토글이 실제로 오검증을 냈다.
  addLunar("leap-2020-04", "윤달", "2020년 윤4월", birth("2020-04-15", "10:00", { calendarType: "lunar", lunarLeapMonth: true }));
  addLunar("leap-2017-05", "윤달", "2017년 윤5월", birth("2017-05-10", "18:30", { calendarType: "lunar", lunarLeapMonth: true, gender: "여성" }));
  addLunar("leap-2014-09", "윤달", "2014년 윤9월", birth("2014-09-22", "03:15", { calendarType: "lunar", lunarLeapMonth: true }));

  // ── 시간 미상 2건 — 시주 UNKNOWN 전파 ──────────────────────────────────
  add("notime-1978", "시간 미상", "시주를 반영하지 않아야 합니다", birth("1978-11-03", "", { timeUnknown: true }));
  add("notime-2001", "시간 미상", "시주를 반영하지 않아야 합니다", birth("2001-03-28", "", { timeUnknown: true, gender: "여성" }));

  // ── 일반 회귀 12건 — 연대·성별·지역 분산 ───────────────────────────────
  const regular: Array<[string, string, Partial<BirthInput>]> = [
    ["1945-08-15", "06:00", {}],
    ["1963-12-01", "21:45", { gender: "여성" }],
    ["1971-02-19", "11:10", { city: "부산" }],
    ["1980-06-30", "00:30", { gender: "여성", city: "대구" }],
    ["1991-07-15", "09:30", { gender: "여성" }],
    ["1999-12-31", "23:59", {}],
    ["2000-01-01", "00:01", { gender: "여성" }],
    ["2008-10-09", "15:20", { city: "제주" }],
    ["2013-04-05", "08:00", { gender: "여성", city: "강릉" }],
    ["2019-09-23", "19:05", {}],
    ["1968-03-11", "13:40", { calendarType: "lunar" }],
    ["1984-11-27", "05:55", { gender: "여성", calendarType: "lunar" }],
  ];
  regular.forEach(([date, time, overrides], index) => {
    const input = birth(date, time, overrides);
    const emit = input.calendarType === "lunar" ? addLunar : add;
    emit(`regular-${index + 1}`, "일반 회귀", "특이 조건 없는 대조군", input);
  });

  return cases;
}

const STEMS = "갑을병정무기경신임계";
const BRANCHES = "자축인묘진사오미신유술해";
/** 실재하는 60갑자인지. 오탈자가 유파 차이로 오인되는 걸 막는다. */
function invalidGanji(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return !(trimmed.length === 2 && STEMS.includes(trimmed[0]) && BRANCHES.includes(trimmed[1]));
}

function generate() {
  // 사람이 채운 expected 는 절대 잃지 않는다. 재생성은 케이스 정의만 갱신한다.
  let previous = new Map<string, GoldenCase["expected"]>();
  try {
    const existing = JSON.parse(readFileSync(CASES_PATH, "utf8")) as GoldenCase[];
    previous = new Map(existing.map((item) => [item.id, item.expected]));
  } catch {
    // 파일이 없으면 최초 생성이다.
  }

  const cases: GoldenCase[] = buildCases().map((item) => ({
    ...item,
    expected: previous.get(item.id) ?? item.expected,
    engineOutput: pillarsOf(item.input),
  }));
  mkdirSync(dirname(CASES_PATH), { recursive: true });
  writeFileSync(CASES_PATH, `${JSON.stringify(cases, null, 2)}\n`, "utf8");

  const groups = new Map<string, number>();
  for (const item of cases) groups.set(item.group, (groups.get(item.group) ?? 0) + 1);
  console.log(`골든 케이스 ${cases.length}건 생성 → tests/golden/chart.cases.json`);
  for (const [group, count] of groups) console.log(`  ${group}: ${count}건`);

  const kept = cases.filter((item) => Object.values(item.expected).some((value) => value.trim())).length;
  if (kept) console.log(`\n기존 기입 ${kept}건을 보존했습니다.`);
  if (kept < cases.length) console.log(`⚠ 미기입 ${cases.length - kept}건 — 만세력과 대조해 채워 주세요.`);
}

function verify() {
  let raw: string;
  try {
    raw = readFileSync(CASES_PATH, "utf8");
  } catch {
    console.log("골든 케이스 파일이 없습니다. --generate 로 먼저 만드세요.");
    return;
  }
  const cases = JSON.parse(raw) as GoldenCase[];
  const unverified: string[] = [];
  const mismatches: string[] = [];
  const typos: string[] = [];

  for (const item of cases) {
    // 시간 미상은 시주가 의미 없다(엔진이 정오를 임의 대입한다 — §6-6).
    const keys = item.input.timeUnknown
      ? (["year", "month", "day"] as const)
      : (["year", "month", "day", "hour"] as const);

    // 오탈자를 먼저 잡는다. 실재하지 않는 간지는 불일치가 아니라 기입 실수다.
    for (const key of keys) {
      if (invalidGanji(item.expected[key])) {
        typos.push(`${item.id} ${key}: "${item.expected[key]}" — 실재하지 않는 간지입니다`);
      }
    }

    const filled = keys.every((key) => item.expected[key].trim().length > 0);
    if (!filled) {
      unverified.push(item.id);
      continue;
    }
    const actual = pillarsOf(item.input);
    for (const key of keys) {
      if (invalidGanji(item.expected[key])) continue;
      if (actual[key] !== item.expected[key]) {
        mismatches.push(`${item.id} [${item.group}] ${key}: 만세력 ${item.expected[key]} ≠ 엔진 ${actual[key]}`);
      }
    }
  }

  const verified = cases.length - unverified.length;
  console.log(`chart golden: ${verified}/${cases.length}건 검증됨 (프로파일 ${DEFAULT_PROFILE.id})`);
  if (unverified.length) {
    console.log(`  미검증 ${unverified.length}건: ${unverified.slice(0, 5).join(", ")}${unverified.length > 5 ? " …" : ""}`);
  }
  if (typos.length) {
    console.error(`\n기입 오류 ${typos.length}건 — 실재하지 않는 간지입니다:`);
    for (const line of typos) console.error(`  ${line}`);
  }
  if (mismatches.length) {
    console.error(`\n불일치 ${mismatches.length}건:`);
    for (const line of mismatches) console.error(`  ${line}`);
    console.error("\n원인 분리: node .test-dist/scripts/chart-diagnose.js");
    console.error("  설정 차이인지 엔진 버그인지 가려 줍니다.");
  }
  assert.equal(typos.length, 0, "실재하지 않는 간지가 기입되어 있습니다.");
  assert.equal(mismatches.length, 0, "만세력과 불일치하는 케이스가 있습니다.");
}

if (process.argv.includes("--generate")) generate();
else verify();
