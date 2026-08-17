import type { ReadingInput } from "./reading-types";
import { normalizeText } from "./fork/classify";

/**
 * 고위험 사건 차단 (ROADMAP M1-C).
 *
 * 이 검사는 라우트에서 **L2보다 먼저** 돈다. 차단 대상 서술이 외부 모델로
 * 나가서는 안 되기 때문이다. 따라서 여기가 뚫리면 그 보장도 함께 무너진다.
 *
 * **L2와 같은 정규화를 쓴다.** 공백·문장부호를 넣어 우회하는 경우
 * ("이 혼", "죽.었", "자-살")를 같은 규칙으로 막는다. 정규화가 두 벌이면
 * 한쪽만 강해지고 다른 쪽이 뚫린다.
 *
 * 판정은 **코드가 한다.** 모델에게 묻지 않는다 — 실패 시 사람이 다뤄야 하는
 * 영역이고, 모델 장애나 예산 소진이 안전 판정을 흔들면 안 된다.
 */

/**
 * 사유 코드별 차단어.
 *
 * ⚠ **목록 자체는 안전 정책이다.** 무엇을 막을지 바꾸는 것은 코드 정리가
 * 아니라 제품 결정이므로, 임의로 빼거나 더하지 말 것.
 *
 * 사유를 나눠 두는 이유: 차단 사유별 발생 빈도를 봐야 오탐을 조정할 수 있다.
 * 원문은 저장하지 않고 **사유 코드만** 센다.
 */
const BLOCKLIST: ReadonlyArray<{ reason: string; words: readonly string[] }> = [
  // ⚠ **순서가 의미를 갖는다. 더 구체적인 군이 먼저 와야 한다.**
  // "성폭력"은 "폭력"을 포함하므로 violence 가 앞서면 sexual-violence 로
  // 절대 분류되지 않는다. 픽스처가 실제로 이 실수를 잡았다.
  // 객체 키 순서에 기대지 않으려고 배열로 둔다.
  { reason: "sexual-violence", words: ["성폭력", "성폭행", "강간"] },
  { reason: "self-harm", words: ["자살", "극단적선택", "극단적인선택"] },
  { reason: "death", words: ["죽고", "죽었", "사망", "살해"] },
  { reason: "violence", words: ["폭력", "폭행", "학대"] },
  { reason: "accident", words: ["교통사고", "사고로"] },
  { reason: "loss", words: ["유산", "이혼"] },
];

export type SafetyVerdict =
  | { blocked: false }
  | { blocked: true; reason: string; matched: string };

/**
 * 차단 여부와 **사유**를 함께 낸다.
 *
 * 원문이나 매칭 위치는 돌려주지 않는다 — 호출부가 로그에 남길 수 있는 것은
 * 사유 코드와 어떤 단어군이었는지까지다.
 */
export function classifySafetyDetailed(input: ReadingInput): SafetyVerdict {
  const raw = [input.event.story, input.event.outcome, input.event.alternative]
    .filter(Boolean)
    .join(" ");
  const text = normalizeText(raw);

  for (const { reason, words } of BLOCKLIST) {
    const matched = words.find((word) => text.includes(word));
    if (matched) return { blocked: true, reason, matched };
  }
  return { blocked: false };
}

/** 기존 호출부 호환. 불리언만 필요할 때 쓴다. */
export function classifySafety(input: ReadingInput): boolean {
  return classifySafetyDetailed(input).blocked;
}

/**
 * 차단 사유별 카운터. **원문은 저장하지 않는다.**
 *
 * 오탐 조정의 유일한 근거다 — "이혼"이 정당한 갈림길인데 막히고 있다면,
 * 그 사실은 이 카운터에서만 드러난다. 기록 실패는 무시한다. 계량 때문에
 * 차단 응답이 늦어지거나 실패하면 안 된다.
 */
export async function recordSafetyBlock(reason: string) {
  if (process.env.NODE_ENV !== "production"
    && !process.env.FIRESTORE_EMULATOR_HOST
    && process.env.FIREBASE_STORAGE_BACKEND !== "firestore") return;
  try {
    const { getFirebaseAdminFirestore } = await import("./firebase-admin");
    const { FieldValue } = await import("firebase-admin/firestore");
    await getFirebaseAdminFirestore()
      .collection("internalMetrics").doc("phase-zero")
      .set({ [`safetyBlock_${reason}`]: FieldValue.increment(1) }, { merge: true });
  } catch (error) {
    console.error("안전 차단 계량 실패", error);
  }
}
