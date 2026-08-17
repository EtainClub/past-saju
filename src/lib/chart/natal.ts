import { calculateFourPillars, type FiveElement, type FourPillarsDetail } from "manseryeok";
import { DEFAULT_PROFILE } from "./profile";
import { PRODUCER } from "./branch-relation";
import { resolveSolarBirthDate } from "../birth-date";
import type { BirthInput } from "../reading-types";

/**
 * 원국(原局) 계산 — 「내 사주」와 「오늘의 운세」가 함께 쓰는 명식.
 *
 * 두 화면이 각자 계산하면 유파 파라미터가 갈리는 날이 온다. 같은 사람에게
 * 다른 일주를 보여 주는 순간 둘 다 신뢰를 잃으므로 여기 한 곳에서 낸다.
 */

/** 시간 미상이면 정오를 대입한다. 이 값으로 낸 **시주는 화면에 내면 안 된다.** */
export function natalChart(birth: BirthInput): FourPillarsDetail {
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
export function natalStrength(chart: FourPillarsDetail, timeUnknown: boolean) {
  const dayElement = chart.dayElement.stem;
  const supports = (element: FiveElement) => element === dayElement || element === PRODUCER[dayElement];
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
    : chart.monthElement.branch === PRODUCER[dayElement] ? 7 : 0;
  const score = Math.round(40 * deukRyeong + 25 * deukJi + 25 * deukSe + season);
  const { strong, weak } = DEFAULT_PROFILE.strengthThresholds;
  return { score, band: score >= strong ? "신강" as const : score < weak ? "신약" as const : "중간" as const };
}
