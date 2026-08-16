import type { NarrativeSpec, ReadingResult } from "../reading-types";
import { isGrounded } from "../fork/evidence";

/**
 * L5 충실성 검사 — 렌더링 결과가 확정된 사실을 벗어나지 않았는지.
 *
 * 3단이며 **전부 결정론**이다. 별도 LLM 판정 호출은 쓰지 않는다.
 *   1단 validateNarrative (template.ts) — 전환점 누락·단정 표현·우월 결말
 *   2단 이 파일 — 인용 근거, 개월 수 언급, 불변 주제 포함
 *   3단 이 파일 — 문단이 선언한 factId가 실제 spec에 있는지
 *
 * 위반 사유는 문자열 배열로 돌려주고, 호출부가 지표에 남긴 뒤 폴백한다.
 */

export type FidelityInput = {
  result: ReadingResult;
  spec: NarrativeSpec;
  /** 사용자 원문(story + outcome + alternative). 인용 검증의 기준. */
  source: string;
  /** 문단별로 모델이 선언한 fact id */
  declaredFactIds: string[];
  /** 모델이 인용했다고 주장하는 원문 조각 */
  quotedFragments: string[];
};

export function factIdsOf(spec: NarrativeSpec) {
  return spec.turningPoints.map((_, index) => `F${index + 1}`);
}

export function checkFidelity(input: FidelityInput): { ok: boolean; violations: string[] } {
  const { result, spec, source, declaredFactIds, quotedFragments } = input;
  const violations: string[] = [];

  // 2단-a. 인용은 원문에 실재해야 한다. 지어낸 지명·금액·인물은 여기서 걸린다.
  const ungrounded = quotedFragments.filter((fragment) => !isGrounded(fragment, source));
  if (ungrounded.length) violations.push(`근거 없는 인용(${ungrounded.length}건)`);

  // 2단-b. 타임라인은 해당 개월 수를 반드시 말해야 한다.
  const prose = [...result.overview, ...result.timeline.map((item) => item.text), result.commonFate].join(" ");
  const missingMonths = spec.turningPoints.filter((point) => !prose.includes(`${point.monthOffset}개월`));
  if (missingMonths.length) violations.push(`전환점 개월 누락(${missingMonths.map((p) => p.monthOffset).join(",")})`);

  // 2단-c. 불변 주제는 그대로 실려야 한다. 어느 길을 골라도 남는 과제라는 장치의 핵심.
  if (!result.commonFate.includes(spec.invariantTheme.statement)) violations.push("불변 주제 누락");

  // 3단. 선언한 factId가 실제로 존재하는지.
  const known = new Set(factIdsOf(spec));
  const unknownIds = [...new Set(declaredFactIds)].filter((id) => !known.has(id));
  if (unknownIds.length) violations.push(`없는 fact 참조(${unknownIds.join(",")})`);

  return { ok: violations.length === 0, violations };
}
