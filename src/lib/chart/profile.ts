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
  /** 신강·신약 경계. score >= strong 이면 신강, < weak 이면 신약 */
  strengthThresholds: { strong: number; weak: number };
};

export const DEFAULT_PROFILE: SajuProfile = {
  id: "kr-yajasi-eokbu-v1",

  /**
   * 야자시설(夜子時說). 23:00~24:00 출생은 **일주는 당일을 유지**하고
   * 시주 천간만 다음날 일간에서 뽑는다.
   *
   * 채택 이유:
   *   1. 한국 명리 실무에서 야자시/조자시를 구분하는 것이 다수설이고,
   *      국내 만세력 프로그램들이 이 방식을 표준으로 표기한다.
   *   2. 일간은 이 서비스 해석의 중심('나')이다. 사용자가 입력한 날짜와
   *      일주가 어긋나면 근거란이 곧바로 이상해 보인다.
   *
   * 대안: "jasi"(23시부터 완전히 다음날) — 자시설. 바꾸려면 이 한 줄만 고치면
   * 되지만 23:00~23:59 출생자의 일주가 통째로 달라진다.
   */
  dayBoundary: "splitJasi",

  /**
   * TODO(유파확인): 득령 40 + 득지 25 + 득세 25 + 계절보정 최대 10 점수식의
   * 경계값. §7-2 미결정 — 현재 값은 기존 구현을 그대로 옮긴 것이다.
   */
  strengthThresholds: { strong: 55, weak: 45 },
};
