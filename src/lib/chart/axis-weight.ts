import { getBranchTenGod, getTenGod, type FourPillarsDetail, type Pillar, type TenGod } from "manseryeok";
import { AXES, axisFromTenGod } from "../ten-god-axis";
import type { TenGodAxis } from "../reading-types";
import { DEFAULT_PROFILE } from "./profile";

/**
 * 십신 축 가중치 — **「내 사주」와 「이야기」의 단일 출처**.
 *
 * 원래 이 계산은 `reading-engine.ts` 안에만 있었다. 그래서 이야기 탭은
 * "왜 이 세 갈래인지"를 알고 있었지만 내 사주 화면은 몰랐고, 같은 명식에서
 * 나온 두 화면이 서로 모른 척했다(docs/CHART-LLM-EXPANSION.md §2-2).
 *
 * 갈림길 편향(bias)은 여기 없다. 편향은 **카드 축 선택에만** 얹는 것이고,
 * 용신·기신은 명식 판정이라 갈림길이 바꾸면 안 된다 — L1/L2 경계.
 */

export type AxisWeights = {
  /** 축별 가중 점수. 용신 보정(+1.2)까지 반영된 값이다. */
  scores: Map<TenGodAxis, number>;
  /** 점수 내림차순. */
  ranked: Array<[TenGodAxis, number]>;
  usefulAxes: TenGodAxis[];
  hostileAxes: TenGodAxis[];
};

export function weighAxes(
  chart: FourPillarsDetail,
  strengthScore: number,
  timeUnknown: boolean,
  activeLuck: Pillar | null,
): AxisWeights {
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
  const { strong, weak } = DEFAULT_PROFILE.strengthThresholds;
  const useful = strengthScore >= strong ? ["식상", "재성", "관성"] : strengthScore < weak ? ["인성", "비겁"] : ["식상", "인성", "재성"];
  useful.forEach((axis) => scores.set(axis as TenGodAxis, (scores.get(axis as TenGodAxis) ?? 0) + 1.2));
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const usefulPool: TenGodAxis[] = strengthScore >= strong ? ["식상", "재성", "관성"] : strengthScore < weak ? ["인성", "비겁"] : ranked.slice(0, 2).map(([axis]) => axis);
  const hostilePool: TenGodAxis[] = strengthScore >= strong ? ["비겁", "인성"] : strengthScore < weak ? ["식상", "재성", "관성"] : ranked.slice(-2).map(([axis]) => axis);
  return {
    scores,
    ranked,
    usefulAxes: usefulPool.sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0)),
    hostileAxes: hostilePool.sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0)),
  };
}

/** 용신도 기신도 아닌 축은 '중립'이다. 화면이 세 상태를 구분해 보여 준다. */
export function axisRole(weights: AxisWeights, axis: TenGodAxis): "용신" | "기신" | "중립" {
  if (weights.usefulAxes.includes(axis)) return "용신";
  if (weights.hostileAxes.includes(axis)) return "기신";
  return "중립";
}
