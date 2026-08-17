/**
 * 모델 단가 (USD / 100만 토큰).
 *
 * 출처: Anthropic 요금 페이지, 2026-08-17 확인.
 *
 * 캐시 쓰기는 **5분 TTL 기준**이다. 우리는 `cache_control: { type: "ephemeral" }`
 * 만 쓰므로 5m 요율이 적용된다. 1h TTL을 쓰게 되면 표를 늘려야 한다.
 *
 * ⚠ 퇴역 모델과 헷갈리지 말 것. Opus 4.1/4 는 $15/$75 이고 **Opus 5 는 $5/$25** 다.
 *    이 착각으로 2026-08-17 초기 추정이 3배 부풀었다 — docs/WORLDMODEL.md §5.E.
 */
export type ModelPrice = {
  input: number;
  output: number;
  /** 5분 TTL 캐시 쓰기 */
  cacheWrite: number;
  /** 캐시 적중·갱신 */
  cacheRead: number;
};

const PRICES: Record<string, ModelPrice> = {
  "claude-fable-5": { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 },
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

/**
 * 모델 id 는 날짜 접미사가 붙을 수 있다(claude-haiku-4-5-20251001).
 * 가장 긴 접두사부터 맞춰, 새 스냅샷이 나와도 표를 안 고쳐도 되게 한다.
 */
export function priceFor(model: string): ModelPrice | null {
  const key = Object.keys(PRICES)
    .filter((candidate) => model.startsWith(candidate))
    .sort((a, b) => b.length - a.length)[0];
  return key ? PRICES[key] : null;
}

export type TokenUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

/**
 * 실제 청구액. 단가를 모르는 모델이면 null 을 돌려준다 —
 * **0 을 돌려주면 "공짜"로 보여 더 나쁘다.**
 */
export function costOf(model: string, usage: TokenUsage): number | null {
  const price = priceFor(model);
  if (!price) return null;
  const per = (tokens: number | null | undefined, rate: number) => ((tokens ?? 0) / 1_000_000) * rate;
  return per(usage.input_tokens, price.input)
    + per(usage.output_tokens, price.output)
    + per(usage.cache_creation_input_tokens, price.cacheWrite)
    + per(usage.cache_read_input_tokens, price.cacheRead);
}
