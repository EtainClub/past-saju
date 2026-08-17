import type { DayBoundary } from "manseryeok";

/**
 * 유파 파라미터 — 명리 해석이 갈리는 지점을 한곳에 모은다.
 *
 * 여기 값이 바뀌면 **골든 케이스의 정답값도 바뀐다.** 변경 시 tests/golden을
 * 함께 갱신할 것.
 */
export type SajuProfile = {
  id: string;
  /** 23:00~24:00 출생의 일주·시주 처리 */
  dayBoundary: DayBoundary;
  /** 진태양시 산출에 균시차(Equation of Time)를 포함할지 */
  applyEquationOfTime: boolean;
  /** 신강·신약 경계. score >= strong 이면 신강, < weak 이면 신약 */
  strengthThresholds: { strong: number; weak: number };
};

export const DEFAULT_PROFILE: SajuProfile = {
  id: "kr-jasi-eokbu-v1",

  /**
   * 자시설(子時說). 23:00~24:00 출생은 **일주까지 다음날**로 넘어간다.
   *
   * 채택 이유(§7-1, 2026-08-17 재결정):
   *   기준 만세력이 이 방식으로 계산한다. 사용자는 우리 결과를 다른
   *   만세력과 대조하므로, 일주가 갈리면 우리 쪽이 틀린 것으로 보인다.
   *
   * 앞서 "splitJasi"(야자시설)로 정했다가 되돌렸다. 당시 근거가 "국내
   * 만세력이 야자시설로 표기한다"였는데 골든 1차 대조에서 반증됐다
   * — docs/WORLDMODEL.md §5.B-b.
   *
   * 되돌리려면 이 한 줄만 고치면 되지만 23:00~23:59 출생자(약 4.5%)의
   * 일주가 통째로 달라진다.
   */
  dayBoundary: "jasi",

  /**
   * 균시차를 쓰지 않는다 — 경도 보정만 한다(§7-11, 2026-08-17 결정).
   *
   * 천문학적으로는 균시차를 넣은 쪽이 진짜 진태양시다(태양 남중 = 정오).
   * 그러나 기준 만세력은 경도 보정만 하고, 명리는 관습 체계라 시장이 쓰지
   * 않는 보정을 우리만 넣으면 "더 정확한" 게 아니라 "혼자 다른" 게 된다.
   * 최대 16분 차이로 시주가 약 6% 갈린다.
   */
  applyEquationOfTime: false,

  /**
   * TODO(유파확인): 득령 40 + 득지 25 + 득세 25 + 계절보정 최대 10 점수식의
   * 경계값. §7-2 미결정 — 현재 값은 기존 구현을 그대로 옮긴 것이다.
   */
  strengthThresholds: { strong: 55, weak: 45 },
};
