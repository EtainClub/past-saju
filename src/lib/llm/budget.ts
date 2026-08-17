import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdminFirestore } from "../firebase-admin";

/**
 * 일일 호출 예산.
 *
 * 무인증 공개 엔드포인트 뒤에 유료 호출이 있으므로, 속도 제한(IP 단위)만으로는
 * 분산된 남용을 막지 못한다. 전체 호출 수에 하루 단위 상한을 둔다.
 * 상한에 닿으면 예외를 던지지 않고 false를 돌려주며, 호출부는 조용히 폴백한다.
 */

const COLLECTION = "internalMetrics";
const DOCUMENT = "llmBudget";
/** 토큰 누적은 날짜별 문서로 나눈다. 상한 문서와 달리 지난 날치를 보존해야 한다. */
const USAGE_DOCUMENT = "llmUsage";

export const DAILY_CALL_BUDGET = Number(process.env.LLM_DAILY_CALL_BUDGET ?? "500") || 500;

const globalForBudget = globalThis as unknown as {
  pastSajuLlmBudget?: Map<string, number>;
  pastSajuLlmUsage?: Map<string, number>;
};
const memoryBudget = globalForBudget.pastSajuLlmBudget ?? new Map<string, number>();
globalForBudget.pastSajuLlmBudget = memoryBudget;
const memoryUsage = globalForBudget.pastSajuLlmUsage ?? new Map<string, number>();
globalForBudget.pastSajuLlmUsage = memoryUsage;

function shouldUseFirestore() {
  if (process.env.NODE_ENV === "production") return true;
  if (process.env.FIRESTORE_EMULATOR_HOST) return true;
  return process.env.FIREBASE_STORAGE_BACKEND === "firestore";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 예산 한 건을 확보한다. 확보에 성공하면 true.
 *
 * 저장소 장애 시에는 false를 돌려준다(fail-closed). 속도 제한과 달리 여기서
 * 열어 두면 비용이 무제한으로 새므로, 세지 못하면 쓰지 않는다.
 */
export async function reserveLlmCall(): Promise<boolean> {
  const day = today();

  if (!shouldUseFirestore()) {
    const used = memoryBudget.get(day) ?? 0;
    if (used >= DAILY_CALL_BUDGET) return false;
    memoryBudget.set(day, used + 1);
    return true;
  }

  const db = getFirebaseAdminFirestore();
  const ref = db.collection(COLLECTION).doc(DOCUMENT);
  try {
    return await db.runTransaction<boolean>(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const data = snapshot.data() ?? {};
      const used = data.day === day ? Number(data.calls ?? 0) : 0;
      if (used >= DAILY_CALL_BUDGET) return false;
      transaction.set(ref, { day, calls: used + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
  } catch (error) {
    console.error("LLM 예산 확보 실패", error);
    return false;
  }
}

/**
 * 실제 소비 토큰. 상한은 호출 수로 걸지만 **비용은 토큰에 비례**하므로,
 * 호출 수만 세면 "500회 썼다"는 알아도 "얼마 나왔다"는 모른다.
 *
 * 층(l2/l5)별로 나눠 적는다. 둘은 크기도 단가 구조도 다르다 —
 * L2는 짧고 캐시가 잘 듣고, L5는 길고 thinking 토큰이 출력에 합산된다.
 *
 * 예산 확보와 달리 실패해도 무시한다. 계량이 실패했다고 이미 끝난 응답을
 * 버릴 이유는 없다.
 */
export type LlmUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export async function recordLlmUsage(layer: "l2" | "l5", usage: LlmUsage | undefined | null) {
  if (!usage) return;
  const day = today();
  const delta = {
    [`${layer}_input`]: Number(usage.input_tokens ?? 0),
    [`${layer}_output`]: Number(usage.output_tokens ?? 0),
    [`${layer}_cacheWrite`]: Number(usage.cache_creation_input_tokens ?? 0),
    [`${layer}_cacheRead`]: Number(usage.cache_read_input_tokens ?? 0),
    [`${layer}_calls`]: 1,
  };

  if (!shouldUseFirestore()) {
    for (const [key, value] of Object.entries(delta)) {
      memoryUsage.set(`${day}:${key}`, (memoryUsage.get(`${day}:${key}`) ?? 0) + value);
    }
    return;
  }

  try {
    const db = getFirebaseAdminFirestore();
    const ref = db.collection(COLLECTION).doc(`${USAGE_DOCUMENT}-${day}`);
    await ref.set(
      {
        day,
        ...Object.fromEntries(Object.entries(delta).map(([key, value]) => [key, FieldValue.increment(value)])),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  } catch (error) {
    console.error("LLM 토큰 계량 실패", error);
  }
}

/** 개발·스크립트용. Firestore를 쓰지 않을 때 누적치를 읽는다. */
export function readMemoryUsage() {
  return new Map(memoryUsage);
}
