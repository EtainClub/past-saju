import type { TenGodAxis } from "../reading-types";

export type DomainId = "CAREER" | "VENTURE" | "RELATION" | "STUDY" | "MOVE" | "WEALTH" | "HEALTH";
export type PolarityId = "LEAVE_STAY" | "EXPAND_CONTRACT" | "JOIN_SEPARATE";
export type PolarityValue = "LEAVE" | "STAY" | "EXPAND" | "CONTRACT" | "JOIN" | "SEPARATE";

/** 엔진이 소비하는 유한 심볼. 자유 서술은 전부 이 4-튜플로 접힌다. */
export type ForkKey = {
  domain: DomainId;
  polarityAxis: PolarityId;
  /** 실제로 택한 극 */
  actualChoice: PolarityValue;
  /** 가지 않은 극 — 카드가 탐색하는 쪽 */
  counterfactual: PolarityValue;
  /** 대안이 얼마나 살아 있었는가. context.readiness + freedom에서 산출 */
  intensity: 1 | 2 | 3;
  timepoint: { year: number; month: number };
  confidence: number;
  source: "pattern" | "llm";
};

/**
 * 렌더러(L5)가 소비하는 원문 발췌.
 * 모든 문자열은 원문의 부분문자열이어야 한다 — 추상화·요약·재작성 금지.
 * A1에서는 비어 있고, A2(LLM 폴백)에서 채워진다.
 */
export type ForkEvidence = {
  subject: string | null;
  stakes: string[];
  constraint: string | null;
  quotes: string[];
};

export type ForkFrame = { key: ForkKey; evidence: ForkEvidence };

export type ForkResult =
  | { status: "CLASSIFIED"; frame: ForkFrame }
  | { status: "UNKNOWN"; reason: string };

/** 십신 축별 가산치. rankedAxes가 카드 선택에만 반영한다(용신·기신에는 미반영). */
export type AxisBias = Partial<Record<TenGodAxis, number>>;
