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
  ReadingResult,
  ReadingSession,
  TenGodAxis,
  TurningPoint,
} from "./reading-types";
import { resolveSolarBirthDate } from "./birth-date";
import { AXES, axisFromTenGod } from "./ten-god-axis";
import { classifyFork } from "./fork/classify";
import { forkBias } from "./fork/bias";
import { DOMAINS, POLE_LABEL } from "./fork/ontology";
import type { AxisBias, ForkResult } from "./fork/types";
const DOMAIN_BY_AXIS: Record<TenGodAxis, Domain> = {
  식상: "학습·내면",
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

const STEM_LABELS: Record<string, string> = {
  갑: "갑목(甲木)", 을: "을목(乙木)", 병: "병화(丙火)", 정: "정화(丁火)", 무: "무토(戊土)",
  기: "기토(己土)", 경: "경금(庚金)", 신: "신금(辛金)", 임: "임수(壬水)", 계: "계수(癸水)",
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

const CHOICE_COPY: Record<TenGodAxis, { title: string; phrase: string }> = {
  식상: { title: "목소리를 내는 길", phrase: "마음을 숨기지 않고, 내가 원하는 변화를 먼저 꺼내 놓는다" },
  관성: { title: "구조를 다시 세우는 길", phrase: "당장 떠나기보다 조건과 책임의 경계를 분명히 다시 정한다" },
  재성: { title: "실리를 고르는 길", phrase: "감정적인 결론을 미루고, 손에 잡히는 조건부터 바꿔 본다" },
  인성: { title: "한 걸음 물러서는 길", phrase: "결정을 서두르지 않고, 준비와 회복을 위한 시간을 먼저 확보한다" },
  비겁: { title: "내 힘으로 나서는 길", phrase: "익숙한 울타리에서 벗어나, 나만의 방식과 동료를 새로 찾는다" },
};

const AXIS_STORY: Record<TenGodAxis, { overview: [string, string]; gains: [string, string, string]; losses: [string, string, string]; vector: string }> = {
  식상: {
    overview: [
      "말하지 않았던 것을 밖으로 꺼냈다면, 이 선택은 끝맺음보다 새로운 표현의 시작이 되었을 가능성이 큽니다. 처음에는 후련함보다 낯섦이 먼저 왔겠지만, 이전과 같은 방식으로는 돌아가지 않았을 거예요.",
      "내 목소리가 또렷해지는 만큼 익숙한 관계와 규칙에는 마찰이 생기고, 그 대가를 지나야 새 리듬이 자리 잡습니다.",
    ],
    gains: ["내 감정을 설명하는 언어", "새로운 시도를 끝까지 밀어 보는 힘", "나와 결이 맞는 관계망"],
    losses: ["익숙한 사람들과의 편안한 침묵", "예측 가능한 일상의 속도", "갈등 뒤 회복에 쓰는 시간"],
    vector: "표현의 폭은 넓어지고, 소속의 경계는 더 선명해지는 방향",
  },
  관성: {
    overview: [
      "떠나거나 끊기보다 조건을 다시 세웠다면, 이 선택은 책임을 떠안는 일이 아니라 책임의 범위를 고르는 일이 되었을 겁니다. 변화는 느리지만 바뀐 규칙은 오래 남았을 가능성이 커요.",
      "단단한 구조는 기회와 압박을 함께 만듭니다. 인정이 커지는 만큼 기대도 따라오므로, 모든 일을 잘 해내려는 습관과 거리를 두는 것이 과제가 됩니다.",
    ],
    gains: ["역할을 분명히 하는 협상력", "흔들리지 않는 실무 기반", "시간이 쌓이며 생기는 신뢰"],
    losses: ["가볍게 방향을 바꿀 여지", "책임에서 완전히 벗어난 휴식", "모두에게 좋은 사람으로 남는 편안함"],
    vector: "사회적 기반은 단단해지고, 책임을 고르는 기준은 까다로워지는 방향",
  },
  재성: {
    overview: [
      "옳고 그름보다 실제 조건을 먼저 바꿨다면, 이 선택의 무게는 한 번에 사라지지 않아도 다룰 수 있는 크기로 작아졌을 겁니다. 작은 합의와 숫자가 감정보다 먼저 길을 냈을 가능성이 커요.",
      "손에 잡히는 성과와 관리 부담은 나란히 커집니다. 선택의 효율은 높아지지만, 모든 것을 계산 가능한 문제로 만들지 않는 감각이 필요합니다.",
    ],
    gains: ["현실적인 선택 기준", "생활의 여유를 만드는 자원", "조건을 조율하는 감각"],
    losses: ["계산하지 않고 몰입하는 순간", "오래 미룰 수 있는 자유", "관계를 효율로 보지 않으려는 여유"],
    vector: "생활의 안정은 커지고, 감정과 효율 사이의 경계가 중요한 방향",
  },
  인성: {
    overview: [
      "결론보다 회복과 준비를 먼저 골랐다면, 이 선택은 멈춤이 아니라 시야를 되찾는 유예가 되었을 가능성이 큽니다. 바깥의 변화는 늦지만, 선택을 바라보는 기준은 그 사이 크게 달라졌을 거예요.",
      "천천히 모은 정보가 뒤늦게 힘을 냅니다. 다만 준비가 안전지대가 되기 시작하면 다음 문을 여는 일이 더 어려워지므로, 충분함을 정하는 기준이 필요합니다.",
    ],
    gains: ["나를 소진시키지 않는 속도", "깊어진 판단 기준", "다음 선택을 위한 실질적 준비"],
    losses: ["빠르게 얻을 수 있었던 기회", "주변의 즉각적인 이해", "결정을 미루지 않는 가벼움"],
    vector: "내면의 기준은 깊어지고, 시작을 허락하는 용기는 더 중요해지는 방향",
  },
  비겁: {
    overview: [
      "혼자 감당하는 대신 새로운 동료와 내 방식을 찾았다면, 이 선택은 독립과 연대가 동시에 시작되는 지점이 되었을 겁니다. 익숙한 보호는 줄지만 선택의 주도권은 선명해졌을 가능성이 커요.",
      "경쟁과 협력은 같은 얼굴로 나타납니다. 누구와 나눌지, 어디까지 내 몫으로 남길지를 배울 때 비로소 자유가 소진으로 바뀌지 않습니다.",
    ],
    gains: ["내 이름으로 결정하는 주도권", "새로운 동료와의 연결", "실패를 다시 설계하는 탄력"],
    losses: ["익숙한 울타리의 보호", "자원을 혼자 쓰는 여유", "비교하지 않아도 되는 평온"],
    vector: "독립성은 커지고, 좋은 경쟁과 소진을 가르는 안목이 필요한 방향",
  },
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
  const trueMinutes = (hours * 60 + minutes + (longitude - 135) * 4 + equationOfTime(date) + 1440) % 1440;
  const branchBoundaryDistance = Math.min(...Array.from({ length: 12 }, (_, index) => {
    const boundary = (index * 120 + 60) % 1440;
    const d = Math.abs(trueMinutes - boundary);
    return Math.min(d, 1440 - d);
  }));
  return branchBoundaryDistance <= 10 ? "boundary" : "exact";
}

function hourConfidenceNote(confidence: NarrativeSpec["confidence"]["hourPillar"]) {
  if (confidence === "unknown") return "태어난 시간을 몰라 시주를 명세에서 제외했어요.";
  if (confidence === "boundary") return "진태양시가 시주 경계에 가까워, 시간에서 온 해석은 낮춰 반영했어요.";
  return "출생지를 진태양시로 보정했고, 시주 경계와 충분히 떨어져 있어요.";
}

function forkNote(fork: ForkResult) {
  if (fork.status !== "CLASSIFIED") {
    return "적어 주신 이야기에서 갈림길의 방향을 확정하지 못해, 명식과 운의 흐름만으로 읽었어요.";
  }
  const { domain, actualChoice, counterfactual } = fork.frame.key;
  return `적어 주신 이야기를 ${DOMAINS[domain].label}의 갈림길로 읽었고, ${POLE_LABEL[actualChoice]}을 택하셨다고 보아 ${POLE_LABEL[counterfactual]}을 이 카드에 반영했어요.`;
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
    dayBoundary: "jasi",
    trueSolarTime: {
      longitude: CITY_LONGITUDE[input.birth.city] ?? KOREA_AVERAGE_LONGITUDE,
      applyEquationOfTime: true,
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
  const useful = strengthScore >= 55 ? ["식상", "재성", "관성"] : strengthScore < 45 ? ["인성", "비겁"] : ["식상", "인성", "재성"];
  useful.forEach((axis) => scores.set(axis as TenGodAxis, (scores.get(axis as TenGodAxis) ?? 0) + 1.2));
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const usefulPool: TenGodAxis[] = strengthScore >= 55 ? ["식상", "재성", "관성"] : strengthScore < 45 ? ["인성", "비겁"] : ranked.slice(0, 2).map(([axis]) => axis);
  const hostilePool: TenGodAxis[] = strengthScore >= 55 ? ["비겁", "인성"] : strengthScore < 45 ? ["식상", "재성", "관성"] : ranked.slice(-2).map(([axis]) => axis);
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
    strengthBand: strengthScore >= 55 ? "신강" : strengthScore < 45 ? "신약" : "중간",
    daeunTransition,
    daeunLabel,
    turningPoints: buildTurningPoints(input, chart, ranking.usefulAxes, ranking.hostileAxes, daeunTransition),
    invariant: invariantFromChart(chart, input.birth.timeUnknown, ranking.hostileAxes),
    hourConfidence,
    fork,
  };
}

function choiceText(axis: TenGodAxis, input: ReadingInput) {
  const base = CHOICE_COPY[axis].phrase;
  const category = input.event.category === "기타" ? "그 일" : input.event.category;
  return `${category}의 갈림길에서 ${base}.`;
}

function withTopic(value: string) {
  const last = value.charCodeAt(value.length - 1);
  const hasBatchim = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0;
  return `${value}${hasBatchim ? "은" : "는"}`;
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
  const story = AXIS_STORY[axis];
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

const COST_COPY: Record<NarrativeSpec["costPattern"], string> = {
  관계소원: "그 과정에서 가까운 관계와 잠시 거리가 생기는 비용은 피하기 어렵습니다.",
  소진건강: "성과를 지키려다 회복의 몫까지 당겨 쓰지 않는 것이 중요합니다.",
  재정압박: "선택을 유지하는 동안에는 자원과 생활비의 압박을 현실적으로 살펴야 합니다.",
  평판마찰: "내 뜻을 드러내는 만큼 주변의 평가와 부딪히는 시기를 지나게 됩니다.",
  정체성혼란: "익숙한 역할을 내려놓는 동안 내가 누구인지 다시 묻는 시간이 따라옵니다.",
};

function resultFor(axis: TenGodAxis, input: ReadingInput, context: EngineContext, spec: NarrativeSpec): ReadingResult {
  const choice = CHOICE_COPY[axis];
  const primary = DOMAIN_BY_AXIS[axis];
  const strength = `${context.strengthBand} 경향 · ${context.strengthScore}`;
  const dayMaster = STEM_LABELS[context.chart.day.heavenlyStem];
  const axisPoints = spec.turningPoints;
  const frictionCount = axisPoints.filter((point) => point.valence === "마찰").length;
  const opportunityCount = axisPoints.filter((point) => point.valence === "기회").length;
  const phase = context.daeunTransition ? "전환" : frictionCount >= 2 && opportunityCount >= 1 ? "혼재" : opportunityCount >= 3 ? "상승" : frictionCount >= 3 ? "하강" : "정체";
  const category = input.event.category === "기타" ? "그 선택" : input.event.category;
  const selectedPoints = [axisPoints[0], axisPoints[1], axisPoints[3]];
  const middlePoint = axisPoints[2];
  const freedom = input.context.freedom;
  const fear = input.context.fear;
  const realityNote = freedom <= 2
    ? "당시 선택의 여지가 좁았다는 현실을 크게 반영했어요."
    : fear >= 4
      ? "무언가를 잃을 수 있다는 두려움이 컸다는 점을 결말의 대가에 반영했어요."
      : "당시의 준비도와 선택 가능성을 균형 있게 반영했어요.";

  const stories: Record<TenGodAxis, { overview: string[]; gains: string[]; losses: string[]; vector: string }> = {
    식상: {
      overview: [
        `말하지 않았던 것을 밖으로 꺼냈다면, ${category}은 끝맺음보다 새로운 표현의 시작이 되었을 가능성이 큽니다. 처음에는 후련함보다 낯섦이 먼저 왔겠지만, 이전과 같은 방식으로는 돌아가지 않았을 거예요.`,
        `${phase}의 흐름은 빠른 보상보다 방향 전환을 가리킵니다. 내 목소리가 또렷해지는 만큼 익숙한 관계와 규칙에는 마찰이 생기고, 그 대가를 지나야 새 리듬이 자리 잡습니다.`,
      ],
      gains: ["내 감정을 설명하는 언어", "새로운 시도를 끝까지 밀어 보는 힘", "나와 결이 맞는 관계망"],
      losses: ["익숙한 사람들과의 편안한 침묵", "예측 가능한 일상의 속도", "갈등 뒤 회복에 쓰는 시간"],
      vector: "표현의 폭은 넓어지고, 소속의 경계는 더 선명해지는 방향",
    },
    관성: {
      overview: [
        `떠나거나 끊기보다 조건을 다시 세웠다면, ${category}은 책임을 떠안는 일이 아니라 책임의 범위를 고르는 일이 되었을 겁니다. 변화는 느리지만 바뀐 규칙은 오래 남았을 가능성이 커요.`,
        `${phase}의 흐름에서는 단단한 구조가 기회와 압박을 함께 만듭니다. 인정은 커지지만 기대도 따라오므로, 모든 일을 잘 해내려는 습관과 거리를 두는 것이 이 세계의 과제가 됩니다.`,
      ],
      gains: ["역할을 분명히 하는 협상력", "흔들리지 않는 실무 기반", "시간이 쌓이며 생기는 신뢰"],
      losses: ["가볍게 방향을 바꿀 여지", "책임에서 완전히 벗어난 휴식", "모두에게 좋은 사람으로 남는 편안함"],
      vector: "사회적 기반은 단단해지고, 책임을 고르는 기준은 까다로워지는 방향",
    },
    재성: {
      overview: [
        `옳고 그름보다 실제 조건을 먼저 바꿨다면, ${category}의 무게는 한 번에 사라지지 않아도 다룰 수 있는 크기로 작아졌을 겁니다. 작은 합의와 숫자가 감정보다 먼저 길을 냈을 가능성이 커요.`,
        `${phase}의 흐름은 손에 잡히는 성과와 관리 부담이 나란히 커지는 모습입니다. 선택의 효율은 높아지지만, 모든 것을 계산 가능한 문제로 만들지 않는 감각이 필요합니다.`,
      ],
      gains: ["현실적인 선택 기준", "생활의 여유를 만드는 자원", "조건을 조율하는 감각"],
      losses: ["계산하지 않고 몰입하는 순간", "오래 미룰 수 있는 자유", "관계를 효율로 보지 않으려는 여유"],
      vector: "생활의 안정은 커지고, 감정과 효율 사이의 경계가 중요한 방향",
    },
    인성: {
      overview: [
        `결론보다 회복과 준비를 먼저 골랐다면, ${category}은 멈춤이 아니라 시야를 되찾는 유예가 되었을 가능성이 큽니다. 바깥의 변화는 늦지만, 선택을 바라보는 기준은 그 사이 크게 달라졌을 거예요.`,
        `${phase}의 흐름에서는 천천히 모은 정보가 뒤늦게 힘을 냅니다. 다만 준비가 안전지대가 되기 시작하면 다음 문을 여는 일이 더 어려워지므로, 충분함을 정하는 기준이 필요합니다.`,
      ],
      gains: ["나를 소진시키지 않는 속도", "깊어진 판단 기준", "다음 선택을 위한 실질적 준비"],
      losses: ["빠르게 얻을 수 있었던 기회", "주변의 즉각적인 이해", "결정을 미루지 않는 가벼움"],
      vector: "내면의 기준은 깊어지고, 시작을 허락하는 용기는 더 중요해지는 방향",
    },
    비겁: {
      overview: [
        `혼자 감당하는 대신 새로운 동료와 내 방식을 찾았다면, ${category}은 독립과 연대가 동시에 시작되는 지점이 되었을 겁니다. 익숙한 보호는 줄지만 선택의 주도권은 선명해졌을 가능성이 커요.`,
        `${phase}의 흐름에서는 경쟁과 협력이 같은 얼굴로 나타납니다. 누구와 나눌지, 어디까지 내 몫으로 남길지를 배울 때 비로소 자유가 소진으로 바뀌지 않습니다.`,
      ],
      gains: ["내 이름으로 결정하는 주도권", "새로운 동료와의 연결", "실패를 다시 설계하는 탄력"],
      losses: ["익숙한 울타리의 보호", "자원을 혼자 쓰는 여유", "비교하지 않아도 되는 평온"],
      vector: "독립성은 커지고, 좋은 경쟁과 소진을 가르는 안목이 필요한 방향",
    },
  };
  const story = stories[axis];
  story.overview[1] = `${spec.fortunePhase} 국면에서 ${spec.primaryDomain} 영역이 가장 먼저 움직입니다. ${story.overview[1]} ${COST_COPY[spec.costPattern]}`;
  const timeCopy = [
    `처음 ${selectedPoints[0].monthOffset}개월 무렵에는 선택의 여파가 ${selectedPoints[0].domain}에서 먼저 드러납니다. 속도를 내기보다 바뀐 감각에 이름을 붙이는 시간이었을 거예요.`,
    `${selectedPoints[1].monthOffset}개월째 전후로 ${selectedPoints[1].relation}의 흐름이 강해집니다. 이어 ${middlePoint.monthOffset}개월째에는 ${middlePoint.domain}의 ${middlePoint.relation}이 겹치며, 이 길을 계속 갈 이유를 스스로 다시 정하게 됩니다.`,
    `${selectedPoints[2].monthOffset}개월을 지나면 변화는 사건이 아니라 생활 방식이 됩니다. ${story.vector}으로 천천히 수렴했을 가능성이 큽니다.`,
  ];
  const invariant = `어느 길을 골라도 ${withTopic(spec.invariantTheme.statement)} 다시 만났을 겁니다. 달라지는 것은 과제의 유무가 아니라, 그것을 알아차리고 다루는 방식입니다.`;
  const pillars = context.chart.toObject();

  return {
    schemaVersion: "2.0",
    title: choice.title,
    choiceText: choiceText(axis, input),
    choiceAxis: axis,
    overview: story.overview,
    timeline: [
      { label: "3개월의 문턱", month: selectedPoints[0].monthOffset, text: timeCopy[0], tone: "neutral" },
      { label: "1년의 파문", month: selectedPoints[1].monthOffset, text: timeCopy[1], tone: "cool" },
      { label: "3년의 풍경", month: selectedPoints[2].monthOffset, text: timeCopy[2], tone: "warm" },
    ],
    gains: [...spec.gainAxes],
    losses: [...spec.lossAxes],
    commonFate: invariant,
    closingLine: "다른 선택이 더 나은 삶을 약속하지는 않습니다. 다만 지금의 당신이 무엇을 지켜 왔는지는 조금 더 선명하게 보여 줍니다.",
    basis: {
      pillars: input.birth.timeUnknown
        ? `${pillars.year} · ${pillars.month} · ${pillars.day} · 시주 미반영`
        : Object.values(pillars).join(" · "),
      dayMaster,
      strength,
      daeun: context.daeunLabel,
      usefulFlow: `용신 축 ${context.usefulAxes.join("·")} · 기신 축 ${context.hostileAxes.join("·")}`,
      eventFlow: `사건 시점은 ${spec.fortunePhase} 국면으로 읽히며, ${primary} 영역의 움직임을 가장 크게 반영했어요. ${forkNote(context.fork)}`,
      turningPointsUsed: spec.turningPoints.map((point) => ({ monthOffset: point.monthOffset, label: `${point.domain} ${point.relation}` })),
      realityContext: realityNote,
      hourPillarNote: hourConfidenceNote(context.hourConfidence),
      engineVersion: "saju-1.0-eokbu+manseryeok-2.0.0-kasi",
    },
    uncertaintyNote: "이 글은 정해진 미래나 실제로 일어났을 일을 예측하지 않습니다. 사주 규칙을 바탕으로 지나간 선택을 다른 각도에서 성찰하도록 만든 반사실 서사입니다.",
  };
}

function validateNarrative(spec: NarrativeSpec, result: ReadingResult) {
  const prose = [...result.overview, ...result.timeline.map((item) => item.text), result.commonFate].join(" ");
  const missingTurns = spec.turningPoints.filter((point) => !prose.includes(`${point.monthOffset}개월`));
  const timelineProse = result.timeline.map((item) => item.text).join(" ");
  const absoluteClaims = ["반드시 일어", "틀림없이", "운명적으로 피할 수 없", "확실한 미래", "병에 걸", "법적으로 해야"];
  const violations = [
    missingTurns.length > 0 && `전환점 ${missingTurns.map((point) => point.monthOffset).join(",")}`,
    !result.overview.some((paragraph) => paragraph.includes(spec.primaryDomain)) && "주요 영역",
    !timelineProse.includes(spec.primaryDomain) && "타임라인 주요 영역",
    spec.gainAxes.some((gain) => !result.gains.includes(gain)) && "얻는 것",
    spec.lossAxes.some((loss) => !result.losses.includes(loss)) && "놓는 것",
    !result.overview.some((paragraph) => paragraph.includes(COST_COPY[spec.costPattern])) && "비용 패턴",
    !result.commonFate.includes(spec.invariantTheme.statement) && "공통 운명",
    absoluteClaims.some((claim) => prose.includes(claim)) && "단정·지시 표현",
    (!result.gains.length || !result.losses.length || prose.includes("후회할 필요가 없")) && "우월 결말",
    result.timeline.length !== 3 && "타임라인 개수",
  ].filter(Boolean);
  if (violations.length) throw new Error(`NarrativeSpec 위반: ${violations.join(" · ")}`);
}

export function classifySafety(input: ReadingInput) {
  const text = `${input.event.story} ${input.event.outcome} ${input.event.alternative}`.toLowerCase();
  const blocked = ["자살", "죽고", "죽었", "사망", "유산", "이혼", "폭력", "폭행", "성폭력", "강간", "학대", "살해", "교통사고", "사고로", "극단적 선택"];
  return blocked.some((word) => text.includes(word));
}

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
    const result = resultFor(axis, input, context, narrativeSpec);
    validateNarrative(narrativeSpec, result);
    return {
      id: `choice-${index + 1}`,
      axis,
      title: CHOICE_COPY[axis].title,
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
    choices,
    choiceCommitments,
    sessionCommitment: hash([...choiceCommitments].sort().join("|")),
  };
}
