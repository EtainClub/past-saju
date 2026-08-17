import { calculateFourPillars, type FiveElement, type FourPillarsDetail } from "manseryeok";
import { DEFAULT_PROFILE } from "./profile";
import { resolveSolarBirthDate } from "../birth-date";
import { AXES, axisFromTenGod } from "../ten-god-axis";
import type { BirthInput, TenGodAxis } from "../reading-types";

/**
 * 명식(命式) 요약 — 「내 사주」 화면이 쓰는 결정론 산출물.
 *
 * **LLM 이 붙지 않는다.** 명식은 정답이 있는 계산이고(골든 43건으로 고정),
 * 해석은 이 화면의 일이 아니다. 여기서 하는 것은 계산된 것을 보여 주는 것뿐이며
 * 길흉이나 예언은 말하지 않는다.
 *
 * 유파 파라미터는 서사와 **같은 프로파일**을 쓴다. 화면마다 다른 자시 규칙을
 * 쓰면 근거란과 명식이 어긋나 보인다.
 */

export type PillarView = {
  label: string;
  korean: string;
  hanja: string;
  stemElement: FiveElement;
  branchElement: FiveElement;
  /** 천간의 십신. 일주는 '나' 자신이라 십신이 없다. */
  stemTenGod: string | null;
  branchTenGod: string;
};

export type ChartSummary = {
  pillars: PillarView[];
  /** 일간 — 이 사람을 가리키는 글자. 해석의 중심이다. */
  dayMaster: { korean: string; hanja: string; element: FiveElement };
  /** 오행 분포. 시간 미상이면 시주를 빼고 센다. */
  elements: Array<{ element: FiveElement; count: number }>;
  strength: { score: number; band: "신강" | "신약" | "중간" };
  /** 십신 축 분포. 서사의 다섯 갈래와 같은 축이다. */
  axes: Array<{ axis: TenGodAxis; count: number }>;
  luck: {
    available: boolean;
    /** 성별 미입력이면 대운을 못 낸다. 이유를 화면에 적어야 한다. */
    reason: string | null;
    startAge: number;
    forward: boolean;
    pillars: Array<{ age: number; korean: string; current: boolean }>;
  };
  timeUnknown: boolean;
  profileId: string;
};

const ELEMENT_ORDER: FiveElement[] = ["목", "화", "토", "금", "수"];

function chartOf(birth: BirthInput): FourPillarsDetail {
  const solar = resolveSolarBirthDate(birth);
  if (!solar) throw new Error("유효하지 않은 생년월일입니다.");
  const [hour, minute] = birth.timeUnknown || !birth.time ? [12, 0] : birth.time.split(":").map(Number);
  return calculateFourPillars({
    year: solar.year, month: solar.month, day: solar.day, hour, minute,
    gender: birth.gender === "남성" ? "male" : birth.gender === "여성" ? "female" : undefined,
    dayBoundary: DEFAULT_PROFILE.dayBoundary,
    trueSolarTime: {
      longitude: 126.978,
      applyEquationOfTime: DEFAULT_PROFILE.applyEquationOfTime,
      applyHistoricalDst: true,
    },
  });
}

/** 신강·신약 점수. 서사 엔진과 같은 식을 쓴다 — 두 곳이 다르면 사용자가 먼저 안다. */
function strengthOf(chart: FourPillarsDetail, timeUnknown: boolean) {
  const dayElement = chart.dayElement.stem;
  const producer: Record<FiveElement, FiveElement> = { 목: "수", 화: "목", 토: "화", 금: "토", 수: "금" };
  const supports = (element: FiveElement) => element === dayElement || element === producer[dayElement];
  const all: FiveElement[] = [
    chart.yearElement.stem, chart.yearElement.branch,
    chart.monthElement.stem, chart.monthElement.branch,
    chart.dayElement.stem, chart.dayElement.branch,
  ];
  if (!timeUnknown) all.push(chart.hourElement.stem, chart.hourElement.branch);
  const deukRyeong = supports(chart.monthElement.branch) ? 1 : 0;
  const deukJi = supports(chart.dayElement.branch) ? 1 : 0;
  const deukSe = all.filter(supports).length / all.length;
  const season = chart.monthElement.branch === dayElement ? 10
    : chart.monthElement.branch === producer[dayElement] ? 7 : 0;
  const score = Math.round(40 * deukRyeong + 25 * deukJi + 25 * deukSe + season);
  const { strong, weak } = DEFAULT_PROFILE.strengthThresholds;
  return { score, band: score >= strong ? "신강" as const : score < weak ? "신약" as const : "중간" as const };
}

export function summarizeChart(birth: BirthInput, today = new Date()): ChartSummary {
  const chart = chartOf(birth);
  const timeUnknown = birth.timeUnknown || !birth.time;
  const hanja = chart.toHanjaObject();

  const pillars: PillarView[] = [
    { label: "년주", korean: chart.yearString, hanja: hanja.year.hanja, stemElement: chart.yearElement.stem, branchElement: chart.yearElement.branch, stemTenGod: chart.tenGods.year.stem, branchTenGod: chart.tenGods.year.branch },
    { label: "월주", korean: chart.monthString, hanja: hanja.month.hanja, stemElement: chart.monthElement.stem, branchElement: chart.monthElement.branch, stemTenGod: chart.tenGods.month.stem, branchTenGod: chart.tenGods.month.branch },
    // 일간은 '나' 자신이므로 십신이 없다. null 로 두어 화면이 '비어 있음'을 알게 한다.
    { label: "일주", korean: chart.dayString, hanja: hanja.day.hanja, stemElement: chart.dayElement.stem, branchElement: chart.dayElement.branch, stemTenGod: null, branchTenGod: chart.tenGods.day.branch },
    { label: "시주", korean: chart.hourString, hanja: hanja.hour.hanja, stemElement: chart.hourElement.stem, branchElement: chart.hourElement.branch, stemTenGod: chart.tenGods.hour.stem, branchTenGod: chart.tenGods.hour.branch },
  ];

  // 시간 미상이면 시주는 엔진이 정오를 임의 대입한 값이다. 보여 주면 안 된다.
  const visible = timeUnknown ? pillars.slice(0, 3) : pillars;

  const elementCounts = new Map<FiveElement, number>(ELEMENT_ORDER.map((element) => [element, 0]));
  for (const pillar of visible) {
    elementCounts.set(pillar.stemElement, (elementCounts.get(pillar.stemElement) ?? 0) + 1);
    elementCounts.set(pillar.branchElement, (elementCounts.get(pillar.branchElement) ?? 0) + 1);
  }

  const axisCounts = new Map<TenGodAxis, number>(AXES.map((axis) => [axis, 0]));
  for (const pillar of visible) {
    if (pillar.stemTenGod) {
      const axis = axisFromTenGod(pillar.stemTenGod as Parameters<typeof axisFromTenGod>[0]);
      axisCounts.set(axis, (axisCounts.get(axis) ?? 0) + 1);
    }
    const branchAxis = axisFromTenGod(pillar.branchTenGod as Parameters<typeof axisFromTenGod>[0]);
    axisCounts.set(branchAxis, (axisCounts.get(branchAxis) ?? 0) + 1);
  }

  const luck = chart.luckPillars;
  const solar = resolveSolarBirthDate(birth)!;
  const ageNow = today.getFullYear() + today.getMonth() / 12 - (solar.year + (solar.month - 1) / 12);
  const preciseStart = luck ? luck.startYears + luck.startMonths / 12 + luck.startDays / 365 : 0;
  const currentIndex = luck && ageNow >= preciseStart
    ? Math.min(luck.pillars.length - 1, Math.floor((ageNow - preciseStart) / 10))
    : -1;

  return {
    pillars: visible,
    dayMaster: { korean: chart.day.heavenlyStem, hanja: hanja.day.hanja.slice(0, 1), element: chart.dayElement.stem },
    elements: ELEMENT_ORDER.map((element) => ({ element, count: elementCounts.get(element) ?? 0 })),
    strength: strengthOf(chart, timeUnknown),
    axes: AXES.map((axis) => ({ axis, count: axisCounts.get(axis) ?? 0 })),
    luck: {
      available: Boolean(luck),
      // 성별 미입력이면 manseryeok 이 대운을 내지 않는다. 화면이 조용히 비면 고장으로 보인다.
      reason: luck ? null : "성별을 입력하지 않으면 대운의 방향(순행·역행)을 정할 수 없어요.",
      startAge: luck?.startAge ?? 0,
      forward: luck?.forward ?? true,
      pillars: (luck?.pillars ?? []).map((pillar, index) => ({
        age: Math.round(preciseStart) + index * 10,
        korean: pillar.korean,
        current: index === currentIndex,
      })),
    },
    timeUnknown,
    profileId: DEFAULT_PROFILE.id,
  };
}
