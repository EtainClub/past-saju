import { getTenGod, type FiveElement } from "manseryeok";
import { DEFAULT_PROFILE } from "./profile";
import { natalChart, natalStrength } from "./natal";
import { axisRole, weighAxes } from "./axis-weight";
import { resolveSolarBirthDate } from "../birth-date";
import { AXES, axisFromTenGod } from "../ten-god-axis";
import { AXIS_COPY } from "../render/template";
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
  /**
   * 축 브릿지 — 이야기 탭의 세 갈래가 **이 명식에서 어떻게 나왔는지**.
   *
   * 여기까지가 계산이다. 해석은 없다. LLM 도 없다.
   */
  bridge: {
    axes: Array<{
      axis: TenGodAxis;
      /** 이야기 카드 제목. 두 화면이 같은 이름으로 같은 축을 부른다. */
      title: string;
      /** 원국·대운 가중 점수(용신 보정 포함). 상대 비교용이다. */
      weight: number;
      role: "용신" | "기신" | "중립";
      /** 갈림길 편향 없이 뽑은 상위 3축에 들었는가. */
      inStory: boolean;
    }>;
    /** 현재 대운 천간의 십신 축. 대운이 없으면 null. */
    luckAxis: TenGodAxis | null;
    luckLabel: string | null;
  };
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

export function summarizeChart(birth: BirthInput, today = new Date()): ChartSummary {
  const chart = natalChart(birth);
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
  const activeLuck = currentIndex >= 0 ? luck!.pillars[currentIndex] : null;

  // ── 축 브릿지 ────────────────────────────────────────────────────────
  // 이야기 탭이 카드 세 장을 고를 때 쓰는 것과 **같은 가중치**를 부른다.
  // 여기서 따로 세면 "왜 이 카드가 나왔는지"의 설명이 실제 이유와 달라진다.
  const strength = natalStrength(chart, timeUnknown);
  const weights = weighAxes(chart, strength.score, timeUnknown, activeLuck?.pillar ?? null);
  // 갈림길 편향은 세션마다 다르므로 빼고 뽑는다 — 화면은 "대체로 이 세 갈래"까지만 말한다.
  const storyAxes = weights.ranked.slice(0, 3).map(([axis]) => axis);

  return {
    pillars: visible,
    dayMaster: { korean: chart.day.heavenlyStem, hanja: hanja.day.hanja.slice(0, 1), element: chart.dayElement.stem },
    elements: ELEMENT_ORDER.map((element) => ({ element, count: elementCounts.get(element) ?? 0 })),
    strength,
    axes: AXES.map((axis) => ({ axis, count: axisCounts.get(axis) ?? 0 })),
    bridge: {
      axes: weights.ranked.map(([axis, weight]) => ({
        axis,
        title: AXIS_COPY[axis].title,
        weight: Math.round(weight * 10) / 10,
        role: axisRole(weights, axis),
        inStory: storyAxes.includes(axis),
      })),
      luckAxis: activeLuck ? axisFromTenGod(getTenGod(chart.day.heavenlyStem, activeLuck.pillar.heavenlyStem)) : null,
      luckLabel: activeLuck ? activeLuck.korean : null,
    },
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
