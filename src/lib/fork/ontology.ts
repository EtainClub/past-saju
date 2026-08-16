import type { EventCategory, TenGodAxis } from "../reading-types";
import type { AxisBias, DomainId, PolarityId, PolarityValue } from "./types";

/**
 * 갈림길 온톨로지 — 사람이 편집하는 데이터 테이블.
 *
 * 주 1회 미분류(queue/unknowns) 검토 후 PATTERNS에 항목을 추가한다.
 * 변경은 항상 사람 승인을 거친다. YAML이 아닌 이유는 enum이 reading-types의
 * TenGodAxis와 컴파일 타임에 맞물려야 하기 때문이다(오타 = 빌드 실패).
 */

export const POLARITY_POLES: Record<PolarityId, readonly [PolarityValue, PolarityValue]> = {
  LEAVE_STAY: ["LEAVE", "STAY"],
  EXPAND_CONTRACT: ["EXPAND", "CONTRACT"],
  JOIN_SEPARATE: ["JOIN", "SEPARATE"],
};

export function oppositePole(axis: PolarityId, value: PolarityValue): PolarityValue {
  const [a, b] = POLARITY_POLES[axis];
  return value === a ? b : a;
}

type DomainSpec = {
  label: string;
  polarityAxis: PolarityId;
  /** "@일지" = 배우자궁(일지)의 십신에서 사람마다 도출. §7-4 결정(2026-08-16) */
  axis: readonly TenGodAxis[] | "@일지";
};

export const DOMAINS: Record<DomainId, DomainSpec> = {
  CAREER: { label: "직업", polarityAxis: "LEAVE_STAY", axis: ["관성"] },
  VENTURE: { label: "창업·독립", polarityAxis: "EXPAND_CONTRACT", axis: ["식상", "재성"] },
  RELATION: { label: "관계", polarityAxis: "JOIN_SEPARATE", axis: "@일지" },
  STUDY: { label: "학업", polarityAxis: "EXPAND_CONTRACT", axis: ["인성"] },
  MOVE: { label: "거주·이주", polarityAxis: "LEAVE_STAY", axis: ["비겁"] },
  WEALTH: { label: "재물", polarityAxis: "EXPAND_CONTRACT", axis: ["재성"] },
  HEALTH: { label: "건강", polarityAxis: "EXPAND_CONTRACT", axis: ["인성"] },
};

/** 사용자가 이미 고른 카테고리는 도메인의 사전 힌트다. 확정이 아니라 가중치. */
export const CATEGORY_HINT: Record<EventCategory, DomainId | null> = {
  이직: "CAREER",
  이사: "MOVE",
  연애: "RELATION",
  진학: "STUDY",
  창업: "VENTURE",
  투자: "WEALTH",
  가족: "RELATION",
  기타: null,
};

/**
 * 갈림길 → 십신 축 편향.
 * 키는 `${domain}:${counterfactual}` — 가지 않은 쪽이 카드가 탐색하는 방향이다.
 * RELATION은 고정 항목이 없다. 일지(배우자궁)의 십신에서 도출한다(relationBias).
 */
export const BIAS: Partial<Record<string, AxisBias>> = {
  "CAREER:LEAVE": { 식상: +1.2, 비겁: +0.8, 관성: -0.6 },
  "CAREER:STAY": { 관성: +1.2, 인성: +0.8, 식상: -0.6 },

  "VENTURE:EXPAND": { 식상: +1.2, 재성: +0.8, 인성: -0.6 },
  "VENTURE:CONTRACT": { 인성: +1.0, 관성: +0.6, 식상: -0.6 },

  "STUDY:EXPAND": { 인성: +1.2, 식상: +0.6, 재성: -0.6 },
  "STUDY:CONTRACT": { 재성: +1.0, 관성: +0.6, 인성: -0.6 },

  "MOVE:LEAVE": { 비겁: +1.0, 식상: +0.8, 인성: -0.6 },
  "MOVE:STAY": { 인성: +1.0, 관성: +0.6, 비겁: -0.6 },

  "WEALTH:EXPAND": { 재성: +1.2, 식상: +0.6, 인성: -0.6 },
  "WEALTH:CONTRACT": { 인성: +1.0, 비겁: +0.6, 재성: -0.6 },

  "HEALTH:EXPAND": { 식상: +0.8, 비겁: +0.6, 관성: -0.6 },
  "HEALTH:CONTRACT": { 인성: +1.2, 비겁: +0.4, 관성: -0.8 },
};

export type Pattern = {
  /** 정규화된 텍스트에서 찾을 조각 (공백·문장부호 제거 후 비교) */
  match: readonly string[];
  domain: DomainId;
  /** 이 표현이 나타내는 극 */
  pole: PolarityValue;
};

/**
 * 1단계 결정론 패턴. 히트하면 LLM 호출 없이 종료한다(비용 0).
 * outcome은 실제 선택, alternative는 가지 않은 쪽을 서술하므로 스캔 시 극을 뒤집는다.
 */
export const PATTERNS: readonly Pattern[] = [
  // CAREER
  // 도메인은 CATEGORY_HINT가 거의 정해 주므로, 패턴은 극성을 가르는 데 집중한다.
  // "이직 제안을 받았지만 남았다" 같은 문장이 양쪽에 모두 히트하지 않게 종결어까지 포함한다.
  { match: ["퇴사", "그만두", "그만뒀", "이직했", "이직을했", "이직하기로", "회사를떠났", "회사를나왔", "직장을옮", "회사를옮", "사표", "퇴직"], domain: "CAREER", pole: "LEAVE" },
  { match: ["남았", "남기로했", "잔류", "버텼", "계속다니", "계속일하", "승진을받", "눌러앉"], domain: "CAREER", pole: "STAY" },

  // VENTURE
  { match: ["창업", "독립했", "사업을시작", "회사를차", "가게를열", "프리랜"], domain: "VENTURE", pole: "EXPAND" },
  { match: ["사업을접", "폐업", "취업을선택", "다시취직", "창업을포기"], domain: "VENTURE", pole: "CONTRACT" },

  // RELATION
  { match: ["헤어지", "헤어졌", "이별", "결별", "관계를정리", "연락을끊", "이혼"], domain: "RELATION", pole: "SEPARATE" },
  { match: ["결혼", "고백", "다시만", "재회", "함께살", "동거", "관계를이어"], domain: "RELATION", pole: "JOIN" },

  // STUDY
  { match: ["진학", "대학원", "유학", "편입", "공부를더", "학위", "복학"], domain: "STUDY", pole: "EXPAND" },
  { match: ["자퇴", "휴학", "학업을접", "공부를그만", "진학을포기"], domain: "STUDY", pole: "CONTRACT" },

  // MOVE
  { match: ["이사했", "이사를갔", "이주", "상경", "고향을떠", "해외로", "지방으로내려", "이민"], domain: "MOVE", pole: "LEAVE" },
  { match: ["머물기로", "이사를포기", "그대로살", "안갔"], domain: "MOVE", pole: "STAY" },

  // WEALTH
  { match: ["투자했", "매수", "집을샀", "대출을받", "빚을내", "청약"], domain: "WEALTH", pole: "EXPAND" },
  { match: ["팔았", "매도", "손절", "투자를포기", "청산", "정리매도", "저축만"], domain: "WEALTH", pole: "CONTRACT" },

  // HEALTH
  { match: ["무리했", "참고일", "미뤘", "치료를미"], domain: "HEALTH", pole: "EXPAND" },
  { match: ["쉬기로", "휴직", "치료를받", "요양", "회복에집중", "일을줄"], domain: "HEALTH", pole: "CONTRACT" },
];

export const ONTOLOGY_VERSION = 1;

/** 근거란에 노출할 극 이름. */
export const POLE_LABEL: Record<PolarityValue, string> = {
  LEAVE: "떠나는 쪽",
  STAY: "남는 쪽",
  EXPAND: "넓히는 쪽",
  CONTRACT: "줄이는 쪽",
  JOIN: "이어 가는 쪽",
  SEPARATE: "정리하는 쪽",
};
