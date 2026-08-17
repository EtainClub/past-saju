import type { EarthlyBranch, FiveElement } from "manseryeok";

/**
 * 지지 관계 — 충·합·형.
 *
 * 서사 엔진(`reading-engine.ts`)과 「오늘의 운세」가 **같은 표**를 봐야 한다.
 * 한쪽만 고치면 같은 날짜를 두 화면이 다르게 읽고, 사용자는 그걸 바로 안다.
 */

export const PRODUCER: Record<FiveElement, FiveElement> = { 목: "수", 화: "목", 토: "화", 금: "토", 수: "금" };
/** 상생 — 이 오행이 낳는 오행. */
export const PRODUCES: Record<FiveElement, FiveElement> = { 목: "화", 화: "토", 토: "금", 금: "수", 수: "목" };
/** 상극 — 이 오행이 이기는 오행. */
export const CONTROLS: Record<FiveElement, FiveElement> = { 목: "토", 토: "수", 수: "화", 화: "금", 금: "목" };

export const CLASH: Record<string, string> = { 자: "오", 오: "자", 축: "미", 미: "축", 인: "신", 신: "인", 묘: "유", 유: "묘", 진: "술", 술: "진", 사: "해", 해: "사" };
export const COMBINE: Record<string, string> = { 자: "축", 축: "자", 인: "해", 해: "인", 묘: "술", 술: "묘", 진: "유", 유: "진", 사: "신", 신: "사", 오: "미", 미: "오" };

export type BranchRelation = "충" | "합" | "형";

export function branchRelation(source: EarthlyBranch, target: EarthlyBranch): BranchRelation | null {
  if (CLASH[source] === target) return "충";
  if (COMBINE[source] === target) return "합";
  if (source === target && ["진", "오", "유", "해"].includes(source)) return "형";
  if ((source === "자" && target === "묘") || (source === "묘" && target === "자")) return "형";
  const punishment = new Set([source, target]);
  if ((punishment.has("인") && punishment.has("사")) || (punishment.has("사") && punishment.has("신")) || (punishment.has("축") && punishment.has("술")) || (punishment.has("술") && punishment.has("미"))) return "형";
  return null;
}
