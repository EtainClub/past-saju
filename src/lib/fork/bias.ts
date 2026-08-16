import type { FourPillarsDetail } from "manseryeok";
import type { TenGodAxis } from "../reading-types";
import { axisFromTenGod } from "../ten-god-axis";
import { BIAS } from "./ontology";
import type { AxisBias, ForkKey } from "./types";

/**
 * 편향 상한. 대운 천간 가중치(1.8)와 같게 두어 갈림길이 명식을 이기지 못하게 한다.
 * "사주가 고른 세 개의 길"이라는 카피의 전제다.
 */
export const BIAS_CAP = 1.8;

const RELATION_WEIGHT = 1.2;

function clamp(value: number) {
  return Math.max(-BIAS_CAP, Math.min(BIAS_CAP, value));
}

/**
 * 관계 도메인의 축은 표에서 읽지 않고 일지(日支, 배우자궁)의 십신에서 도출한다.
 * 성별 입력에 의존하지 않으므로 gender "응답 안 함" 사용자도 동일하게 동작한다.
 * 전통 규칙(남명 재성 / 여명 관성)은 채택하지 않는다 — docs/WORLDMODEL.md §3.1-a.
 */
function relationBias(key: ForkKey, chart: FourPillarsDetail): AxisBias {
  const axis = axisFromTenGod(chart.tenGods.day.branch);
  const sign = key.counterfactual === "JOIN" ? 1 : -1;
  return { [axis]: sign * RELATION_WEIGHT };
}

/**
 * 갈림길 → 십신 축 가산치.
 * 가지 않은 극(counterfactual)이 카드가 탐색하는 방향이므로 그쪽을 증폭한다.
 * intensity 2를 1.0배 기준으로 스케일한다(1 → 0.5배, 3 → 1.5배).
 */
export function forkBias(key: ForkKey, chart: FourPillarsDetail): AxisBias {
  const base = key.domain === "RELATION"
    ? relationBias(key, chart)
    : BIAS[`${key.domain}:${key.counterfactual}`] ?? {};
  const scale = key.intensity / 2;
  const scaled: AxisBias = {};
  for (const [axis, delta] of Object.entries(base) as Array<[TenGodAxis, number]>) {
    scaled[axis] = clamp(delta * scale);
  }
  return scaled;
}
