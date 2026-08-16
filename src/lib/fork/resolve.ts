import type { ReadingInput } from "../reading-types";
import { llmEnabled } from "../llm/client";
import { reserveLlmCall } from "../llm/budget";
import { enqueueForkUnknown, recordForkClassified } from "../queue/unknowns";
import { classifyFork } from "./classify";
import { classifyForkWithLlm } from "./classify-llm";
import type { ForkResult } from "./types";

/**
 * L2 전체 경로 — 패턴 → LLM 폴백 → UNKNOWN.
 *
 * **엔진 밖(라우트 경계)에서 호출한다.** createReadingSession은 순수 동기 함수로
 * 남아야 하므로, 신경망 호출은 여기서 끝내고 확정된 심볼만 엔진에 넘긴다.
 * 이것이 L1~L4 결정론 원칙을 지키는 방법이다 — docs/WORLDMODEL.md §0.2.
 *
 * 호출부는 반드시 classifySafety 통과 이후에 부를 것. 차단 대상 서술이
 * 외부로 나가면 안 된다.
 */
export async function resolveFork(input: ReadingInput): Promise<ForkResult> {
  // 1단계 — 결정론 패턴. 히트하면 LLM 호출 없이 끝난다(비용 0).
  const byPattern = classifyFork(input);
  if (byPattern.status === "CLASSIFIED") {
    await recordForkClassified("pattern");
    return byPattern;
  }

  // 2단계 — LLM 폴백. 킬스위치가 꺼져 있거나 예산을 넘으면 건너뛴다.
  if (!llmEnabled()) {
    await enqueueForkUnknown(input, byPattern.reason);
    return byPattern;
  }
  if (!(await reserveLlmCall())) {
    await enqueueForkUnknown(input, "budget-exhausted");
    return { status: "UNKNOWN", reason: "budget-exhausted" };
  }

  const byLlm = await classifyForkWithLlm(input);
  if (byLlm.status === "CLASSIFIED") {
    await recordForkClassified("llm");
    return byLlm;
  }

  // 3단계 — 미분류. 사용자에게는 명식 기반 서사를 그대로 제공하고,
  // 원문은 온톨로지 개선을 위해 큐에 남긴다.
  await enqueueForkUnknown(input, byLlm.reason);
  return byLlm;
}
