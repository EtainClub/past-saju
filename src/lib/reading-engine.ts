import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  calculateFourPillars,
  getBranchTenGod,
  getTenGod,
  type EarthlyBranch,
  type FiveElement,
  type FourPillarsDetail,
  type Pillar,
  type TenGod,
} from "manseryeok";
import type {
  ChoiceSecret,
  Domain,
  NarrativeSpec,
  ReadingInput,
  ReadingSession,
  TenGodAxis,
  TurningPoint,
} from "./reading-types";
import { resolveSolarBirthDate } from "./birth-date";
import { AXES, axisFromTenGod } from "./ten-god-axis";
import { classifyFork } from "./fork/classify";
import { forkBias } from "./fork/bias";
import type { AxisBias, ForkResult } from "./fork/types";
import { AXIS_COPY, choiceText, renderReading, validateNarrative } from "./render/template";
import { DEFAULT_PROFILE } from "./chart/profile";
const DOMAIN_BY_AXIS: Record<TenGodAxis, Domain> = {
  // 식상과 인성이 둘 다 "학습·내면"이던 것을 분리했다(2026-08-16, §7-6 결정).
  // 5축이 4도메인으로 접히면서 카드 세 장 중 두 장이 같은 영역을 말하는 문제가 있었다.
  식상: "표현·창작",
  관성: "직업·명예",
  재성: "재물",
  인성: "학습·내면",
  비겁: "동료·독립",
};
const KOREA_AVERAGE_LONGITUDE = 127.5;
const CITY_LONGITUDE: Record<string, number> = {
  서울: 126.978,
  부산: 129.0756,
  대구: 128.6014,
  인천: 126.7052,
  광주: 126.8526,
  대전: 127.3845,
  울산: 129.3114,
  세종: 127.289,
  제주: 126.5312,
  강릉: 128.8761,
  전주: 127.148,
};
const PRODUCER: Record<FiveElement, FiveElement> = { 목: "수", 화: "목", 토: "화", 금: "토", 수: "금" };
const CLASH: Record<string, string> = { 자: "오", 오: "자", 축: "미", 미: "축", 인: "신", 신: "인", 묘: "유", 유: "묘", 진: "술", 술: "진", 사: "해", 해: "사" };
const COMBINE: Record<string, string> = { 자: "축", 축: "자", 인: "해", 해: "인", 묘: "술", 술: "묘", 진: "유", 유: "진", 사: "신", 신: "사", 오: "미", 미: "오" };

type EngineContext = {
  chart: FourPillarsDetail;
  axes: TenGodAxis[];
  usefulAxes: TenGodAxis[];
  hostileAxes: TenGodAxis[];
  strengthScore: number;
  strengthBand: "신강" | "신약" | "중간";
  daeunTransition: boolean;
  daeunLabel: string;
  turningPoints: TurningPoint[];
  invariant: NarrativeSpec["invariantTheme"];
  hourConfidence: NarrativeSpec["confidence"]["hourPillar"];
  fork: ForkResult;
};

function hash(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

function equationOfTime(date: Date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = Math.floor((date.getTime() - start) / 86_400_000);
  const b = ((360 / 365) * (day - 81) * Math.PI) / 180;
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}

function hourConfidenceBand(input: ReadingInput): NarrativeSpec["confidence"]["hourPillar"] {
  if (input.birth.timeUnknown || !input.birth.time) return "unknown";
  const solarBirth = resolveSolarBirthDate(input.birth);
  if (!solarBirth) return "unknown";
  const date = new Date(
    `${solarBirth.year}-${String(solarBirth.month).padStart(2, "0")}-${String(solarBirth.day).padStart(2, "0")}T${input.birth.time}:00+09:00`,
  );
  const [hours, minutes] = input.birth.time.split(":").map(Number);
  const longitude = CITY_LONGITUDE[input.birth.city] ?? KOREA_AVERAGE_LONGITUDE;
  // 균시차는 프로파일을 따른다. 명식은 안 쓰는데 경계 판정만 쓰면 두 시각이
  // 어긋나 "경계"라는 경고 자체가 다른 순간을 가리킨다 — §7-11.
  // (이 함수 전체가 명식과 별도 계산이라는 더 큰 결함은 §6-3, B3에서 해소)
  const eot = DEFAULT_PROFILE.applyEquationOfTime ? equationOfTime(date) : 0;
  const trueMinutes = (hours * 60 + minutes + (longitude - 135) * 4 + eot + 1440) % 1440;
  const branchBoundaryDistance = Math.min(...Array.from({ length: 12 }, (_, index) => {
    const boundary = (index * 120 + 60) % 1440;
    const d = Math.abs(trueMinutes - boundary);
    return Math.min(d, 1440 - d);
  }));
  return branchBoundaryDistance <= 10 ? "boundary" : "exact";
}

function calculateChart(input: ReadingInput) {
  const solarBirth = resolveSolarBirthDate(input.birth);
  if (!solarBirth) throw new Error("유효하지 않은 생년월일입니다.");
  const [hour, minute] = input.birth.timeUnknown || !input.birth.time
    ? [12, 0]
    : input.birth.time.split(":").map(Number);
  const gender = input.birth.gender === "남성" ? "male" : input.birth.gender === "여성" ? "female" : undefined;
  return calculateFourPillars({
    year: solarBirth.year,
    month: solarBirth.month,
    day: solarBirth.day,
    hour,
    minute,
    gender,
    dayBoundary: DEFAULT_PROFILE.dayBoundary,
    trueSolarTime: {
      longitude: CITY_LONGITUDE[input.birth.city] ?? KOREA_AVERAGE_LONGITUDE,
      applyEquationOfTime: DEFAULT_PROFILE.applyEquationOfTime,
      applyHistoricalDst: true,
    },
  });
}

function calculateStrength(chart: FourPillarsDetail, timeUnknown: boolean) {
  const dayElement = chart.dayElement.stem;
  const supportsDayMaster = (element: FiveElement) => element === dayElement || element === PRODUCER[dayElement];
  const allElements: FiveElement[] = [
    chart.yearElement.stem, chart.yearElement.branch,
    chart.monthElement.stem, chart.monthElement.branch,
    chart.dayElement.stem, chart.dayElement.branch,
  ];
  if (!timeUnknown) allElements.push(chart.hourElement.stem, chart.hourElement.branch);
  const deukRyeong = supportsDayMaster(chart.monthElement.branch) ? 1 : 0;
  const deukJi = supportsDayMaster(chart.dayElement.branch) ? 1 : 0;
  const deukSe = allElements.filter(supportsDayMaster).length / allElements.length;
  const seasonCorrection = chart.monthElement.branch === dayElement
    ? 10
    : chart.monthElement.branch === PRODUCER[dayElement] ? 7 : 0;
  return Math.round(40 * deukRyeong + 25 * deukJi + 25 * deukSe + seasonCorrection);
}

/**
 * 십신 축 순위.
 *
 * 갈림길 편향(bias)은 **카드 축 선택에만** 반영한다.
 * 용신·기신은 명식 판정이므로 갈림길이 바꾸면 안 된다 — L1/L2 경계.
 */
function rankedAxes(
  chart: FourPillarsDetail,
  strengthScore: number,
  timeUnknown: boolean,
  activeLuck: Pillar | null,
  bias: AxisBias,
) {
  const scores = new Map<TenGodAxis, number>(AXES.map((axis) => [axis, 0]));
  const gods: Array<{ god: TenGod; weight: number }> = [
    { god: chart.tenGods.year.stem, weight: 1 }, { god: chart.tenGods.year.branch, weight: 1 },
    { god: chart.tenGods.month.stem, weight: 1.45 }, { god: chart.tenGods.month.branch, weight: 1.45 },
    { god: chart.tenGods.day.branch, weight: 1.15 },
  ];
  if (!timeUnknown) gods.push({ god: chart.tenGods.hour.stem, weight: .8 }, { god: chart.tenGods.hour.branch, weight: .8 });
  if (activeLuck) {
    gods.push(
      { god: getTenGod(chart.day.heavenlyStem, activeLuck.heavenlyStem), weight: 1.8 },
      { god: getBranchTenGod(chart.day.heavenlyStem, activeLuck.earthlyBranch), weight: 1.2 },
    );
  }
  gods.forEach(({ god, weight }) => {
    const axis = axisFromTenGod(god);
    scores.set(axis, (scores.get(axis) ?? 0) + weight);
  });
  const useful = strengthScore >= DEFAULT_PROFILE.strengthThresholds.strong ? ["식상", "재성", "관성"] : strengthScore < DEFAULT_PROFILE.strengthThresholds.weak ? ["인성", "비겁"] : ["식상", "인성", "재성"];
  useful.forEach((axis) => scores.set(axis as TenGodAxis, (scores.get(axis as TenGodAxis) ?? 0) + 1.2));
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const usefulPool: TenGodAxis[] = strengthScore >= DEFAULT_PROFILE.strengthThresholds.strong ? ["식상", "재성", "관성"] : strengthScore < DEFAULT_PROFILE.strengthThresholds.weak ? ["인성", "비겁"] : ranked.slice(0, 2).map(([axis]) => axis);
  const hostilePool: TenGodAxis[] = strengthScore >= DEFAULT_PROFILE.strengthThresholds.strong ? ["비겁", "인성"] : strengthScore < DEFAULT_PROFILE.strengthThresholds.weak ? ["식상", "재성", "관성"] : ranked.slice(-2).map(([axis]) => axis);
  const biased = new Map(scores);
  for (const [axis, delta] of Object.entries(bias) as Array<[TenGodAxis, number]>) {
    biased.set(axis, (biased.get(axis) ?? 0) + delta);
  }
  const cardRanked = [...biased.entries()].sort((a, b) => b[1] - a[1]);
  return {
    axes: cardRanked.slice(0, 3).map(([axis]) => axis),
    usefulAxes: usefulPool.sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0)),
    hostileAxes: hostilePool.sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0)),
  };
}

function branchRelation(source: EarthlyBranch, target: EarthlyBranch): "충" | "합" | "형" | null {
  if (CLASH[source] === target) return "충";
  if (COMBINE[source] === target) return "합";
  if (source === target && ["진", "오", "유", "해"].includes(source)) return "형";
  if ((source === "자" && target === "묘") || (source === "묘" && target === "자")) return "형";
  const punishment = new Set([source, target]);
  if ((punishment.has("인") && punishment.has("사")) || (punishment.has("사") && punishment.has("신")) || (punishment.has("축") && punishment.has("술")) || (punishment.has("술") && punishment.has("미"))) return "형";
  return null;
}

function pillarForMonth(input: ReadingInput, offset: number) {
  const [year, month] = input.event.date.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 15, 3));
  return calculateFourPillars({
    year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: 15, hour: 12, minute: 0,
  });
}

function buildTurningPoints(input: ReadingInput, chart: FourPillarsDetail, usefulAxes: TenGodAxis[], hostileAxes: TenGodAxis[], daeunTransition: boolean): TurningPoint[] {
  const candidates = Array.from({ length: 36 }, (_, index) => {
    const monthOffset = index + 1;
    const flow = pillarForMonth(input, monthOffset);
    const events: Array<{ relation: TurningPoint["relation"]; domain: Domain; intensity: 1 | 2 | 3 | 4; valence: TurningPoint["valence"] }> = [];
    const dayMonthRelation = branchRelation(flow.month.earthlyBranch, chart.day.earthlyBranch);
    const socialMonthRelation = branchRelation(flow.month.earthlyBranch, chart.month.earthlyBranch);
    const dayYearRelation = branchRelation(flow.year.earthlyBranch, chart.day.earthlyBranch);
    if (dayMonthRelation) events.push({ relation: dayMonthRelation, domain: "관계", intensity: dayMonthRelation === "충" ? 3 : 2, valence: dayMonthRelation === "합" ? "기회" : "마찰" });
    if (socialMonthRelation) events.push({ relation: socialMonthRelation, domain: "직업·명예", intensity: socialMonthRelation === "충" ? 3 : 2, valence: socialMonthRelation === "합" ? "기회" : "마찰" });
    if (dayYearRelation) events.push({ relation: dayYearRelation, domain: "관계", intensity: dayYearRelation === "충" ? 4 : 3, valence: dayYearRelation === "합" ? "기회" : "마찰" });
    const activeAxis = axisFromTenGod(getTenGod(chart.day.heavenlyStem, flow.month.heavenlyStem));
    if (events.length === 0 || usefulAxes.includes(activeAxis) || hostileAxes.includes(activeAxis)) {
      const helpful = usefulAxes.includes(activeAxis);
      const hostile = hostileAxes.includes(activeAxis);
      events.push({
        relation: helpful ? "용신 활성" : "기신 활성",
        domain: DOMAIN_BY_AXIS[activeAxis],
        intensity: helpful || hostile ? 2 : 1,
        valence: helpful ? "기회" : hostile ? "마찰" : "혼재",
      });
    }
    const strongest = events.sort((a, b) => b.intensity - a.intensity)[0];
    const score = events.reduce((sum, item) => sum + item.intensity, 0) * (daeunTransition ? 1.5 : 1) + (strongest.valence === "기회" ? 1 : 0);
    return { monthOffset, score, ...strongest };
  });
  const choose = (start: number, end: number) => candidates.filter((item) => item.monthOffset >= start && item.monthOffset <= end).sort((a, b) => b.score - a.score || a.monthOffset - b.monthOffset)[0];
  const selected = [choose(1, 6), choose(7, 15), choose(16, 26), choose(27, 36)];
  return selected.map(({ monthOffset, relation, domain, intensity, valence }) => ({ monthOffset, relation, domain, intensity, valence }));
}

function invariantFromChart(chart: FourPillarsDetail, timeUnknown: boolean, hostileAxes: TenGodAxis[]): NarrativeSpec["invariantTheme"] {
  const palaces = [
    { branch: chart.year.earthlyBranch, label: "가족의 기대" },
    { branch: chart.month.earthlyBranch, label: "사회가 요구하는 역할" },
    { branch: chart.day.earthlyBranch, label: "나의 리듬과 가까운 관계" },
    ...(!timeUnknown ? [{ branch: chart.hour.earthlyBranch, label: "앞으로 만들고 싶은 삶" }] : []),
  ];
  for (let left = 0; left < palaces.length; left += 1) {
    for (let right = left + 1; right < palaces.length; right += 1) {
      const relation = branchRelation(palaces[left].branch, palaces[right].branch);
      if (relation === "충") return { source: "원국충", statement: `${palaces[left].label}와 ${palaces[right].label} 사이의 반복되는 마찰` };
      if (relation === "형") return { source: "원국형", statement: `${palaces[left].label}와 ${palaces[right].label} 사이에서 늦게 드러나는 내적 갈등` };
    }
  }
  const counts = new Map<TenGodAxis, number>();
  const gods: TenGod[] = [chart.tenGods.year.stem, chart.tenGods.year.branch, chart.tenGods.month.stem, chart.tenGods.month.branch, chart.tenGods.day.branch];
  if (!timeUnknown) gods.push(chart.tenGods.hour.stem, chart.tenGods.hour.branch);
  gods.forEach((god) => {
    const axis = axisFromTenGod(god);
    counts.set(axis, (counts.get(axis) ?? 0) + 1);
  });
  const [dominant, dominantCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["비겁" as const, 0];
  return {
    source: dominantCount / gods.length > .4 ? "십신편중" : hostileAxes.includes(dominant) ? "기신상주" : "십신편중",
    statement: `${DOMAIN_BY_AXIS[dominant]}에서 강점과 과잉을 함께 다루는 과제`,
  };
}

function buildEngineContext(input: ReadingInput, resolvedFork?: ForkResult): EngineContext {
  const chart = calculateChart(input);
  const strengthScore = calculateStrength(chart, input.birth.timeUnknown);
  const [eventYear, eventMonth] = input.event.date.split("-").map(Number);
  const solarBirth = resolveSolarBirthDate(input.birth);
  if (!solarBirth) throw new Error("유효하지 않은 생년월일입니다.");
  const eventAge = eventYear + (eventMonth - 1) / 12 - (solarBirth.year + (solarBirth.month - 1) / 12);
  const luck = chart.luckPillars;
  const preciseStart = luck ? luck.startYears + luck.startMonths / 12 + luck.startDays / 365 : 0;
  const nearestBoundary = luck ? preciseStart + Math.round((eventAge - preciseStart) / 10) * 10 : -100;
  const daeunTransition = Boolean(luck && Math.abs(eventAge - nearestBoundary) <= 1.5);
  const luckIndex = luck && eventAge >= preciseStart ? Math.min(luck.pillars.length - 1, Math.floor((eventAge - preciseStart) / 10)) : -1;
  const activeLuck = luckIndex >= 0 && luck ? luck.pillars[luckIndex] : null;
  // L2 — 갈림길을 유한 심볼로 접는다. 미분류면 편향 없이 명식만으로 간다(임의 기본값 금지).
  // L2는 라우트 경계에서 이미 해결된다(resolveFork). 없으면 패턴만으로 동기 분류한다.
  // 어느 쪽이든 이 함수는 순수 동기로 남는다 — L1~L4 결정론 원칙.
  const fork = resolvedFork ?? classifyFork(input);
  const bias: AxisBias = fork.status === "CLASSIFIED" ? forkBias(fork.frame.key, chart) : {};
  const ranking = rankedAxes(chart, strengthScore, input.birth.timeUnknown, activeLuck?.pillar ?? null, bias);
  const hourConfidence = hourConfidenceBand(input);
  const daeunLabel = activeLuck
    ? `${activeLuck.korean} 대운 ${Math.max(1, Math.floor(eventAge - (preciseStart + luckIndex * 10)) + 1)}년차${daeunTransition ? " · 교체기" : ""}`
    : luck ? "첫 대운 시작 전" : "성별 미입력으로 대운은 낮춰 반영";
  return {
    chart,
    axes: ranking.axes,
    usefulAxes: ranking.usefulAxes,
    hostileAxes: ranking.hostileAxes,
    strengthScore,
    strengthBand: strengthScore >= DEFAULT_PROFILE.strengthThresholds.strong ? "신강" : strengthScore < DEFAULT_PROFILE.strengthThresholds.weak ? "신약" : "중간",
    daeunTransition,
    daeunLabel,
    turningPoints: buildTurningPoints(input, chart, ranking.usefulAxes, ranking.hostileAxes, daeunTransition),
    invariant: invariantFromChart(chart, input.birth.timeUnknown, ranking.hostileAxes),
    hourConfidence,
    fork,
  };
}

function buildNarrativeSpec(axis: TenGodAxis, context: EngineContext): NarrativeSpec {
  const primaryDomain = DOMAIN_BY_AXIS[axis];
  const secondaryAxis = context.axes.find((candidate) => candidate !== axis && DOMAIN_BY_AXIS[candidate] !== primaryDomain)
    ?? context.axes.find((candidate) => candidate !== axis)
    ?? axis;
  const turningPoints = context.turningPoints.map((point, index) => ({
    ...point,
    domain: index === 0 ? primaryDomain : point.domain,
    valence: index === 0 || point.domain === primaryDomain ? "기회" as const : point.valence === "기회" ? "혼재" as const : point.valence,
  }));
  const frictionCount = turningPoints.filter((point) => point.valence === "마찰").length;
  const opportunityCount = turningPoints.filter((point) => point.valence === "기회").length;
  const fortunePhase = context.daeunTransition
    ? "전환"
    : frictionCount >= 2 && opportunityCount >= 1 ? "혼재"
      : opportunityCount >= 3 ? "상승" : frictionCount >= 3 ? "하강" : "정체";
  const hostileAxis = context.hostileAxes[0] ?? "인성";
  const costPattern: Record<TenGodAxis, NarrativeSpec["costPattern"]> = {
    식상: "평판마찰",
    관성: "소진건강",
    재성: "재정압박",
    인성: "정체성혼란",
    비겁: "관계소원",
  };
  const hourFactor = context.hourConfidence === "exact" ? 1 : context.hourConfidence === "boundary" ? .76 : .62;
  const strengthFactor = context.strengthBand === "중간" ? .82 : 1;
  const story = AXIS_COPY[axis];
  return {
    specVersion: "2.0",
    fortunePhase,
    phaseIntensity: Math.min(100, 24 + turningPoints.reduce((sum, point) => sum + point.intensity * 7, 0) + (context.daeunTransition ? 18 : 0)),
    daeunTransition: context.daeunTransition,
    primaryDomain,
    secondaryDomain: DOMAIN_BY_AXIS[secondaryAxis],
    turningPoints,
    gainAxes: story.gains,
    lossAxes: story.losses,
    costPattern: costPattern[hostileAxis],
    longTermVector: story.vector,
    invariantTheme: context.invariant,
    confidence: {
      hourPillar: context.hourConfidence,
      strengthBand: context.strengthBand === "중간" ? "moderate" : "clear",
      overall: Number((hourFactor * strengthFactor).toFixed(2)),
    },
  };
}

// classifySafety 는 src/lib/safety.ts 로 옮겼다. L2와 같은 정규화를 써야 해서
// (우회 대응, ROADMAP M1-C) 엔진이 아니라 안전 층에 두는 것이 맞다.

/**
 * 순수 동기 함수. 동일 입력 + 동일 fork는 동일 심볼릭 출력을 낸다.
 * (카드 슬롯 배치만 난수 — 봉인 UX상 위치 예측 불가가 목적)
 *
 * fork를 넘기지 않으면 패턴 매칭만 쓴다. LLM 폴백까지 쓰려면
 * 호출부가 await resolveFork(input) 후 결과를 넘긴다.
 */
export function createReadingSession(input: ReadingInput, resolvedFork?: ForkResult): ReadingSession {
  const id = randomUUID();
  const context = buildEngineContext(input, resolvedFork);
  const axes = context.axes
    .map((axis) => ({ axis, rank: randomBytes(4).readUInt32BE(0) }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ axis }) => axis);
  const choicesWithoutCommitment = axes.map((axis, index) => {
    const narrativeSpec = buildNarrativeSpec(axis, context);
    const result = renderReading(axis, input, context, narrativeSpec);
    validateNarrative(narrativeSpec, result);
    return {
      id: `choice-${index + 1}`,
      axis,
      title: AXIS_COPY[axis].title,
      text: choiceText(axis, input),
      nonce: randomBytes(18).toString("hex"),
      narrativeSpec,
      result,
    };
  });
  const choices: ChoiceSecret[] = choicesWithoutCommitment.map((choice) => ({
    ...choice,
    commitment: hash(`${id}|${choice.id}|${choice.text}|${choice.nonce}`),
  }));
  const choiceCommitments = choices.map((choice) => choice.commitment);
  return {
    id,
    input,
    createdAt: Date.now(),
    fork: context.fork,
    choices,
    choiceCommitments,
    sessionCommitment: hash([...choiceCommitments].sort().join("|")),
  };
}
