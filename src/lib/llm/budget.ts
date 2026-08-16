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

export const DAILY_CALL_BUDGET = Number(process.env.LLM_DAILY_CALL_BUDGET ?? "500") || 500;

const globalForBudget = globalThis as unknown as { pastSajuLlmBudget?: Map<string, number> };
const memoryBudget = globalForBudget.pastSajuLlmBudget ?? new Map<string, number>();
globalForBudget.pastSajuLlmBudget = memoryBudget;

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
