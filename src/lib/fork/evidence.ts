import type { ForkEvidence } from "./types";

/**
 * 발췌 검증 — L5가 인용할 수 있는 것은 원문에 실재하는 문자열뿐이다.
 *
 * 이 검사 하나로 세부 날조가 구조적으로 불가능해진다. 모델이 만들어 낸 지명·금액·
 * 인물은 원문에 없으므로 여기서 떨어진다.
 *
 * 공백과 문장부호 차이는 허용한다(모델이 띄어쓰기를 고칠 수 있다). 단어를 지어내거나
 * 순서를 바꾸면 정규화 후에도 포함되지 않으므로 걸러진다.
 */

function normalize(value: string) {
  return value.normalize("NFC").replace(/[\s\p{P}\p{S}]/gu, "");
}

/** 발췌 하나가 원문에 실재하는지. */
export function isGrounded(fragment: string, source: string) {
  const trimmed = fragment.trim();
  if (!trimmed) return false;
  if (source.includes(trimmed)) return true;
  const needle = normalize(trimmed);
  return needle.length > 0 && normalize(source).includes(needle);
}

/**
 * 근거가 없는 항목만 떨어뜨린다. 분류 자체는 살린다.
 *
 * 발췌는 서사를 풍부하게 하는 부가 정보이고, 심볼(ForkKey)이 본체다.
 * 발췌 하나가 검증에 실패했다고 분류 전체를 버리면 unknownRate만 올라간다.
 */
export function groundEvidence(candidate: ForkEvidence, source: string): { evidence: ForkEvidence; dropped: number } {
  let dropped = 0;
  const keep = (value: string | null) => {
    if (value === null) return null;
    if (isGrounded(value, source)) return value.trim();
    dropped += 1;
    return null;
  };

  const stakes = candidate.stakes.filter((item) => {
    if (isGrounded(item, source)) return true;
    dropped += 1;
    return false;
  });
  const quotes = candidate.quotes.filter((item) => {
    if (isGrounded(item, source)) return true;
    dropped += 1;
    return false;
  });

  return {
    evidence: {
      subject: keep(candidate.subject),
      stakes: stakes.map((item) => item.trim()).slice(0, 3),
      constraint: keep(candidate.constraint),
      quotes: quotes.map((item) => item.trim()).slice(0, 3),
    },
    dropped,
  };
}
