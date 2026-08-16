import Anthropic from "@anthropic-ai/sdk";

/**
 * Anthropic 클라이언트와 비용 통제.
 *
 * LLM은 L2(이해)와 L5(표현)에만 들어간다. 명식·판정·전이·분기·안전·봉인은
 * 코드가 한다 — docs/WORLDMODEL.md §0.2.
 */

/** 서사 품질이 제품 가치 자체이므로 최상위 모델을 쓴다. */
export const MODEL = "claude-opus-5";

let client: Anthropic | undefined;

export function llmEnabled() {
  // 킬스위치. 켜져 있어도 키가 없으면 동작하지 않는다.
  if (process.env.LLM_ENABLED === "false") return false;
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function getAnthropic() {
  client ??= new Anthropic();
  return client;
}

/**
 * 안전 분류기가 요청을 거절할 수 있다(HTTP 200 + stop_reason "refusal").
 * 거절 시 다른 모델로 자동 재시도한다. 조직 설정에 따라 이 베타가 막혀 있으면
 * 400이 나므로, 그 경우 LLM_SERVER_FALLBACK=false로 끌 수 있다.
 */
export function serverFallbackEnabled() {
  return process.env.LLM_SERVER_FALLBACK !== "false";
}

export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
