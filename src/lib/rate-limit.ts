import { Timestamp } from "firebase-admin/firestore";
import { getFirebaseAdminFirestore } from "./firebase-admin";

/**
 * IP 기준 고정 윈도 속도 제한.
 *
 * 현재 세 라우트는 인증이 없다. 스크립트 하나가 Firestore 문서를 무한 생성할 수
 * 있고, LLM이 붙으면 같은 경로가 곧바로 과금 사고가 된다 — docs/WORLDMODEL.md §6-A.
 *
 * TODO(운영확인): 아래 한도는 초안이다. 국내 이동통신은 NAT 비중이 높아 한 IP를
 * 여러 사용자가 공유하므로, 배포 후 429 발생률을 보고 조정할 것.
 */
export const RATE_LIMITS = {
  /** 세션 생성 — 가장 비싼 경로(원국 계산 + Firestore 쓰기, 이후 LLM). */
  session: { limit: 10, windowMs: 60 * 60 * 1000 },
  /** 카드 공개 — 세션당 1회만 유효하므로 세션 한도보다 넉넉해도 된다. */
  stream: { limit: 30, windowMs: 60 * 60 * 1000 },
  feedback: { limit: 30, windowMs: 60 * 60 * 1000 },
  /** 백업 코드 발급 — uid 기준. 정상 사용자는 한 시간에 여러 장 만들 일이 없다. */
  authBackup: { limit: 5, windowMs: 60 * 60 * 1000 },
  /** 백업 코드 복구 — 아직 uid 를 모르므로 IP 기준. 무작위 대입을 늦춘다. */
  authRecovery: { limit: 20, windowMs: 60 * 60 * 1000 },
} as const;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

export type RateLimitVerdict =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSeconds: number };

const COLLECTION = "rateLimits";

const globalForRateLimit = globalThis as unknown as {
  pastSajuRateLimit?: Map<string, { count: number; resetAt: number }>;
};
const memoryCounters = globalForRateLimit.pastSajuRateLimit ?? new Map<string, { count: number; resetAt: number }>();
globalForRateLimit.pastSajuRateLimit = memoryCounters;

function shouldUseFirestore() {
  if (process.env.NODE_ENV === "production") return true;
  if (process.env.FIRESTORE_EMULATOR_HOST) return true;
  return process.env.FIREBASE_STORAGE_BACKEND === "firestore";
}

function windowFor(bucket: RateLimitBucket, now: number) {
  const { windowMs } = RATE_LIMITS[bucket];
  const start = Math.floor(now / windowMs) * windowMs;
  return { start, resetAt: start + windowMs };
}

function pruneMemory(now: number) {
  for (const [key, entry] of memoryCounters) {
    if (entry.resetAt <= now) memoryCounters.delete(key);
  }
}

/**
 * 한 건을 소비하고 통과 여부를 돌려준다.
 *
 * 저장소 장애 시에는 통과시킨다(fail-open). 속도 제한 때문에 정상 사용자가 서비스를
 * 못 쓰는 것보다는 낫고, 저장소가 죽으면 세션 생성 자체가 503으로 막힌다.
 */
export async function consumeRateLimit(bucket: RateLimitBucket, key: string): Promise<RateLimitVerdict> {
  const { limit } = RATE_LIMITS[bucket];
  const now = Date.now();
  const { start, resetAt } = windowFor(bucket, now);
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));

  if (!shouldUseFirestore()) {
    pruneMemory(now);
    const id = `${bucket}:${key}:${start}`;
    const entry = memoryCounters.get(id) ?? { count: 0, resetAt };
    if (entry.count >= limit) return { ok: false, retryAfterSeconds };
    entry.count += 1;
    memoryCounters.set(id, entry);
    return { ok: true, remaining: limit - entry.count };
  }

  const db = getFirebaseAdminFirestore();
  const ref = db.collection(COLLECTION).doc(`${bucket}_${key}_${start}`);

  try {
    return await db.runTransaction<RateLimitVerdict>(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const count = snapshot.exists ? Number(snapshot.data()?.count ?? 0) : 0;
      if (count >= limit) return { ok: false, retryAfterSeconds };
      transaction.set(ref, { count: count + 1, expiresAt: Timestamp.fromMillis(resetAt) });
      return { ok: true, remaining: limit - (count + 1) };
    });
  } catch (error) {
    console.error("속도 제한 카운터 실패", error);
    return { ok: true, remaining: limit };
  }
}

export function rateLimitResponse(verdict: Extract<RateLimitVerdict, { ok: false }>) {
  return Response.json(
    {
      code: "rate-limited",
      message: "잠시 뒤에 다시 시도해 주세요. 짧은 시간에 너무 많이 요청했어요.",
    },
    { status: 429, headers: { "Retry-After": String(verdict.retryAfterSeconds) } },
  );
}
