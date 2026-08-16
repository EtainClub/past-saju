import { randomUUID } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getFirebaseAdminFirestore } from "../firebase-admin";
import type { ReadingInput } from "../reading-types";

/**
 * 미분류 큐 — 월드모델의 진화 루프.
 *
 * 패턴도 LLM도 갈림길을 확정하지 못하면 원문과 사유를 여기에 적재한다.
 * 주 1회 사람이 검토해 fork/ontology.ts의 PATTERNS에 항목을 추가한다.
 * 온톨로지 변경은 항상 사람 승인을 거친다.
 *
 * 보관 기간은 세션과 같은 7일이다. 원문은 개인 서술이므로 예외를 만들지 않는다.
 */

const QUEUE_COLLECTION = "forkUnknowns";
const METRICS_COLLECTION = "internalMetrics";
const METRICS_DOCUMENT = "phase-zero";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

const globalForQueue = globalThis as unknown as {
  pastSajuForkStats?: { classified: number; unknown: number };
};
const memoryStats = globalForQueue.pastSajuForkStats ?? { classified: 0, unknown: 0 };
globalForQueue.pastSajuForkStats = memoryStats;

function shouldUseFirestore() {
  if (process.env.NODE_ENV === "production") return true;
  if (process.env.FIRESTORE_EMULATOR_HOST) return true;
  return process.env.FIREBASE_STORAGE_BACKEND === "firestore";
}

/** unknownRate = unknown / (classified + unknown). 주간 배치로 집계한다. */
export function forkStatsSnapshot() {
  const total = memoryStats.classified + memoryStats.unknown;
  return { ...memoryStats, unknownRate: total === 0 ? 0 : memoryStats.unknown / total };
}

export async function recordForkClassified(source: "pattern" | "llm") {
  memoryStats.classified += 1;
  if (!shouldUseFirestore()) return;
  try {
    await getFirebaseAdminFirestore()
      .collection(METRICS_COLLECTION)
      .doc(METRICS_DOCUMENT)
      .set({ forkClassified: FieldValue.increment(1), [`forkSource_${source}`]: FieldValue.increment(1) }, { merge: true });
  } catch (error) {
    console.error("갈림길 분류 지표 기록 실패", error);
  }
}

/**
 * 미분류를 적재한다. 실패해도 예외를 던지지 않는다 —
 * 큐 기록이 안 됐다고 사용자의 서사를 막을 이유는 없다.
 */
export async function enqueueForkUnknown(input: ReadingInput, reason: string) {
  memoryStats.unknown += 1;
  if (!shouldUseFirestore()) return;

  const now = Date.now();
  try {
    const db = getFirebaseAdminFirestore();
    const batch = db.batch();
    batch.set(db.collection(QUEUE_COLLECTION).doc(randomUUID()), {
      reason,
      category: input.event.category,
      story: input.event.story,
      outcome: input.event.outcome,
      alternative: input.event.alternative,
      createdAt: now,
      expiresAt: Timestamp.fromMillis(now + TTL_MS),
      reviewed: false,
    });
    batch.set(
      db.collection(METRICS_COLLECTION).doc(METRICS_DOCUMENT),
      { forkUnknown: FieldValue.increment(1), [`forkReason_${reason.replace(/-/g, "_")}`]: FieldValue.increment(1) },
      { merge: true },
    );
    await batch.commit();
  } catch (error) {
    console.error("미분류 큐 적재 실패", error);
  }
}
