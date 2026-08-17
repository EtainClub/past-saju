import Anthropic from "@anthropic-ai/sdk";

/**
 * Anthropic 클라이언트와 비용 통제.
 *
 * LLM은 L2(이해)와 L5(표현)에만 들어간다. 명식·판정·전이·분기·안전·봉인은
 * 코드가 한다 — docs/WORLDMODEL.md §0.2.
 */

/** 기본 모델. 층별로 다르게 쓸 수 있다 — modelFor() 참조. */
export const MODEL = "claude-opus-5";

/**
 * 층별 모델.
 *
 * L2와 L5는 요구가 다르다.
 *   L2 — enum 분류 + 원문 발췌. 정답이 좁고 스키마가 강제된다. 틀리면
 *        confidence 미달이나 발췌 검증에서 걸러져 UNKNOWN으로 떨어진다.
 *   L5 — 한국어 서사. **이 서비스의 제품 가치 자체**다. 틀리면 충실성 검사가
 *        잡아 템플릿으로 폴백하므로 안전하지만, 폴백이 잦으면 도입 의미가 없다.
 *
 * 그래서 한 모델로 묶지 않고 환경변수로 각각 정한다. 비교 근거는
 * docs/WORLDMODEL.md §5.D.
 */
export function modelFor(layer: "l2" | "l5"): string {
  const override = layer === "l2" ? process.env.LLM_MODEL_L2 : process.env.LLM_MODEL_L5;
  return override?.trim() || DEFAULT_MODEL[layer];
}

/**
 * 2026-08-17 실측 결과로 정했다 (§5.D).
 *
 * L2 = Haiku 4.5 — 3/3 분류 성공(conf 0.95), Opus의 절반 지연. 스키마가 강제되고
 *      발췌는 코드가 검증하므로 모델이 헐거워도 **틀린 채로 통과할 수 없다.**
 *      Opus를 쓸 이유가 없다.
 *
 * L5 = Opus 5 — Haiku는 충실성이 1~2/3에 그쳤다(전환점 개월 누락). 재시도 1회를
 *      감안해도 폴백률이 25% 안팎이라, 넷 중 하나가 템플릿을 받는다. A4를 도입한
 *      이유가 사라진다. 문장도 명식을 싣지 않고 일반론에 가까웠다.
 *      → 개월 언급을 코드가 보장하도록 바꾸면 재검토할 수 있다.
 */
const DEFAULT_MODEL = {
  l2: "claude-haiku-4-5-20251001",
  l5: MODEL,
} as const;

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

/**
 * 모델별 지원 파라미터.
 *
 * `effort`와 `fallbacks`는 **우리가 얹은 선택 사항**이지 필수가 아니다.
 * 지원하지 않는 모델에 붙이면 400이 나므로 모델에 맞춰 뺀다.
 *
 * 아래는 API가 직접 알려 준 것이다(2026-08-17, `pnpm llm:cost --models`):
 *   claude-sonnet-5            → "does not support the `fallbacks` parameter"
 *   claude-haiku-4-5-20251001  → "does not support the effort parameter"
 *
 * **API가 authority다.** 새 모델을 넣었는데 400이 나면 여기 표를 고칠 것.
 */
export function supportsEffort(model: string) {
  // effort는 Claude 5 계열 기능이다. Haiku 4.5는 그 이전 세대다.
  return /^claude-(opus|sonnet|fable)-5/.test(model);
}

export function supportsFallbacks(model: string) {
  // 현재 opus-5 에서만 확인됐다. sonnet-5 는 명시적으로 거절한다.
  return /^claude-opus-5/.test(model);
}
