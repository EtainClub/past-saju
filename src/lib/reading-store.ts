import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getFirebaseAdminFirestore } from "./firebase-admin";
import type { ReadingResult, ReadingSession } from "./reading-types";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * 저장을 선택한 사용자의 보관기간.
 *
 * 기본은 7일이고, **본인이 저장을 누른 경우에만** 1년으로 늘어난다. 익명
 * 로그인만으로도 저장은 되지만(`api/reading/saved/route.api.ts`), 늘어난
 * 보관기간을 실제로 누리려면 기기를 바꿔도 uid 를 되찾을 방법이 있어야 한다
 * — 구글 연동 또는 백업 코드(`lib/backup-code.ts`)가 그 역할을 한다.
 * 개인정보처리방침에 두 기간을 모두 적어 두었다.
 */
const SAVED_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const SESSIONS_COLLECTION = "readingSessions";
const FEEDBACK_COLLECTION = "readingFeedback";
const METRICS_COLLECTION = "internalMetrics";
const METRICS_DOCUMENT = "phase-zero";

export type FeedbackValue = "plausible" | "uncertain" | "not-really";
export type SessionSelection =
  | { status: "missing" }
  | { status: "conflict" }
  | { status: "ok"; session: ReadingSession; firstSelection: boolean };

const globalForStore = globalThis as unknown as {
  pastSajuSessions?: Map<string, ReadingSession>;
  pastSajuFeedback?: Map<string, { value: FeedbackValue; createdAt: number }>;
  pastSajuMetrics?: {
    sessionsStarted: number;
    cardsSelected: number;
    readingsCompleted: number;
    plausible: number;
    feedbackTotal: number;
  };
};

const memorySessions = globalForStore.pastSajuSessions ?? new Map<string, ReadingSession>();
const memoryFeedback = globalForStore.pastSajuFeedback ?? new Map<string, { value: FeedbackValue; createdAt: number }>();
const memoryMetrics = globalForStore.pastSajuMetrics ?? {
  sessionsStarted: 0,
  cardsSelected: 0,
  readingsCompleted: 0,
  plausible: 0,
  feedbackTotal: 0,
};

globalForStore.pastSajuSessions = memorySessions;
globalForStore.pastSajuFeedback = memoryFeedback;
globalForStore.pastSajuMetrics = memoryMetrics;

function shouldUseFirestore() {
  if (process.env.NODE_ENV === "production") return true;
  if (process.env.FIRESTORE_EMULATOR_HOST) return true;
  return process.env.FIREBASE_STORAGE_BACKEND === "firestore";
}

function expiresAt(createdAt: number, saved = false) {
  return createdAt + (saved ? SAVED_TTL_MS : SESSION_TTL_MS);
}

function isExpired(session: ReadingSession) {
  return Date.now() >= expiresAt(session.createdAt, session.saved);
}

function pruneMemorySessions() {
  for (const [id, session] of memorySessions) {
    if (isExpired(session)) {
      memorySessions.delete(id);
      memoryFeedback.delete(id);
    }
  }
}

function firestoreSessionData(session: ReadingSession) {
  const jsonSafeSession = JSON.parse(JSON.stringify(session)) as ReadingSession;
  return {
    ...jsonSafeSession,
    expiresAt: Timestamp.fromMillis(expiresAt(session.createdAt, session.saved)),
  };
}

function sessionFromFirestore(data: FirebaseFirestore.DocumentData) {
  const session = { ...data };
  delete session.expiresAt;
  return session as ReadingSession;
}

export function readingStoreBackend() {
  return shouldUseFirestore() ? "firestore" : "memory";
}

export async function saveReadingSession(session: ReadingSession) {
  if (!shouldUseFirestore()) {
    pruneMemorySessions();
    memorySessions.set(session.id, session);
    memoryMetrics.sessionsStarted += 1;
    return;
  }

  const db = getFirebaseAdminFirestore();
  const batch = db.batch();
  batch.set(db.collection(SESSIONS_COLLECTION).doc(session.id), firestoreSessionData(session));
  batch.set(
    db.collection(METRICS_COLLECTION).doc(METRICS_DOCUMENT),
    { sessionsStarted: FieldValue.increment(1) },
    { merge: true },
  );
  await batch.commit();
}

export async function selectReadingSession(sessionId: string, slot: number): Promise<SessionSelection> {
  if (!shouldUseFirestore()) {
    pruneMemorySessions();
    const session = memorySessions.get(sessionId);
    if (!session || isExpired(session)) return { status: "missing" };
    if (session.selectedSlot !== undefined && session.selectedSlot !== slot) return { status: "conflict" };

    const firstSelection = session.selectedSlot === undefined;
    if (firstSelection) {
      session.selectedSlot = slot;
      memoryMetrics.cardsSelected += 1;
    }
    return { status: "ok", session, firstSelection };
  }

  const db = getFirebaseAdminFirestore();
  const sessionRef = db.collection(SESSIONS_COLLECTION).doc(sessionId);
  const metricsRef = db.collection(METRICS_COLLECTION).doc(METRICS_DOCUMENT);

  return db.runTransaction<SessionSelection>(async (transaction) => {
    const snapshot = await transaction.get(sessionRef);
    if (!snapshot.exists) return { status: "missing" };

    const session = sessionFromFirestore(snapshot.data()!);
    if (isExpired(session)) {
      transaction.delete(sessionRef);
      return { status: "missing" };
    }
    if (session.selectedSlot !== undefined && session.selectedSlot !== slot) {
      return { status: "conflict" };
    }

    const firstSelection = session.selectedSlot === undefined;
    if (firstSelection) {
      transaction.update(sessionRef, { selectedSlot: slot });
      transaction.set(metricsRef, { cardsSelected: FieldValue.increment(1) }, { merge: true });
      session.selectedSlot = slot;
    }

    return { status: "ok", session, firstSelection };
  });
}

/**
 * LLM으로 렌더링한 결과를 해당 카드에 고정한다.
 *
 * "고른 카드는 끝까지 바뀌지 않아요"가 제품의 약속이므로, 재열람 시 같은 문장이
 * 나와야 한다. 저장에 실패해도 예외를 던지지 않는다 — 이번 응답은 이미 성립했고,
 * 재열람 시 템플릿으로 돌아가는 편이 오류 화면보다 낫다.
 */
export async function saveRenderedResult(sessionId: string, slot: number, result: ReadingResult) {
  if (!shouldUseFirestore()) {
    const session = memorySessions.get(sessionId);
    if (session?.choices[slot]) session.choices[slot].result = result;
    return;
  }

  try {
    const db = getFirebaseAdminFirestore();
    const ref = db.collection(SESSIONS_COLLECTION).doc(sessionId);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return;
      const session = sessionFromFirestore(snapshot.data()!);
      if (!session.choices[slot]) return;
      const choices = JSON.parse(JSON.stringify(session.choices)) as ReadingSession["choices"];
      choices[slot].result = result;
      transaction.update(ref, { choices });
    });
  } catch (error) {
    console.error("렌더 결과 저장 실패", error);
  }
}

export async function markReadingCompleted(sessionId: string) {
  if (!shouldUseFirestore()) {
    const session = memorySessions.get(sessionId);
    if (!session || session.completedAt || isExpired(session)) return;
    session.completedAt = Date.now();
    memoryMetrics.readingsCompleted += 1;
    return;
  }

  const db = getFirebaseAdminFirestore();
  const sessionRef = db.collection(SESSIONS_COLLECTION).doc(sessionId);
  const metricsRef = db.collection(METRICS_COLLECTION).doc(METRICS_DOCUMENT);

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(sessionRef);
    if (!snapshot.exists) return;

    const session = sessionFromFirestore(snapshot.data()!);
    if (session.completedAt || isExpired(session)) return;

    transaction.update(sessionRef, { completedAt: Date.now() });
    transaction.set(metricsRef, { readingsCompleted: FieldValue.increment(1) }, { merge: true });
  });
}

export async function saveReadingFeedback(sessionId: string, value: FeedbackValue) {
  if (!shouldUseFirestore()) {
    pruneMemorySessions();
    if (!memorySessions.has(sessionId)) return "missing" as const;
    if (memoryFeedback.has(sessionId)) return "duplicate" as const;

    memoryFeedback.set(sessionId, { value, createdAt: Date.now() });
    memoryMetrics.feedbackTotal += 1;
    if (value === "plausible") memoryMetrics.plausible += 1;
    return "saved" as const;
  }

  const db = getFirebaseAdminFirestore();
  const sessionRef = db.collection(SESSIONS_COLLECTION).doc(sessionId);
  const feedbackRef = db.collection(FEEDBACK_COLLECTION).doc(sessionId);
  const metricsRef = db.collection(METRICS_COLLECTION).doc(METRICS_DOCUMENT);

  return db.runTransaction(async (transaction) => {
    const [sessionSnapshot, feedbackSnapshot] = await Promise.all([
      transaction.get(sessionRef),
      transaction.get(feedbackRef),
    ]);

    if (!sessionSnapshot.exists) return "missing" as const;
    const session = sessionFromFirestore(sessionSnapshot.data()!);
    if (isExpired(session)) return "missing" as const;
    if (feedbackSnapshot.exists) return "duplicate" as const;

    transaction.set(feedbackRef, {
      sessionId,
      value,
      createdAt: Date.now(),
      expiresAt: Timestamp.fromMillis(expiresAt(session.createdAt)),
    });
    transaction.set(
      metricsRef,
      {
        feedbackTotal: FieldValue.increment(1),
        ...(value === "plausible" ? { plausible: FieldValue.increment(1) } : {}),
      },
      { merge: true },
    );
    return "saved" as const;
  });
}

/* ── 보관과 재열람 ─────────────────────────────────────────────────────
/**
 * 보관과 재열람.
 *
 * 저장은 **사용자가 명시적으로 누른 경우에만** 일어난다. 구글 연동을 했다는
 * 것만으로 보관기간이 늘어나지 않는다 — 연동은 "기기를 바꿔도 내 것"이고,
 * 저장은 "이 이야기를 오래 두겠다"라서 의사표시가 다르다.
 */

export type SavedReading = {
  id: string;
  createdAt: number;
  category: string;
  eventDate: string;
  /** 선택한 카드의 제목. 목록에서 어떤 이야기였는지 알아보게 한다. */
  title: string | null;
  /**
   * 열었던 카드 위치. 재열람에 필요하다 — 다른 슬롯을 요청하면 저장소가
   * conflict 를 낸다(봉인은 한 번만 열린다).
   */
  slot: number | null;
};

export type SaveVerdict = "saved" | "missing" | "forbidden";

/**
 * 세션을 장기 보관으로 표시한다.
 *
 * **본인 확인이 핵심이다.** 세션 id 만 알면 남의 기록을 보관 처리할 수 있으면
 * 안 되므로, 세션에 적힌 uid 와 요청자의 uid 가 같을 때만 허용한다.
 */
export async function markSessionSaved(sessionId: string, uid: string): Promise<SaveVerdict> {
  if (!shouldUseFirestore()) {
    const session = memorySessions.get(sessionId);
    if (!session || isExpired(session)) return "missing";
    if (session.uid !== uid) return "forbidden";
    session.saved = true;
    return "saved";
  }

  const db = getFirebaseAdminFirestore();
  const ref = db.collection(SESSIONS_COLLECTION).doc(sessionId);
  return db.runTransaction<SaveVerdict>(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return "missing";
    const session = sessionFromFirestore(snapshot.data()!);
    if (isExpired(session)) return "missing";
    if (session.uid !== uid) return "forbidden";
    transaction.update(ref, {
      saved: true,
      // TTL 필드를 함께 밀어야 실제 보관기간이 늘어난다. saved 만 세우면
      // Firestore TTL 이 7일에 그대로 지운다.
      expiresAt: Timestamp.fromMillis(expiresAt(session.createdAt, true)),
    });
    return "saved";
  });
}

/**
 * 저장한 이야기 목록. 본문은 싣지 않는다 — 목록에서 남의 눈에 띌 이유가 없고,
 * 상세는 기존 재열람 경로로 본다.
 */
export async function listSavedReadings(uid: string, limit = 20): Promise<SavedReading[]> {
  const summarize = (session: ReadingSession): SavedReading => ({
    id: session.id,
    createdAt: session.createdAt,
    category: session.input.event.category,
    eventDate: session.input.event.date,
    title: session.selectedSlot === undefined ? null : session.choices[session.selectedSlot]?.title ?? null,
    slot: session.selectedSlot ?? null,
  });

  if (!shouldUseFirestore()) {
    pruneMemorySessions();
    return [...memorySessions.values()]
      .filter((session) => session.uid === uid && session.saved)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map(summarize);
  }

  const snapshot = await getFirebaseAdminFirestore()
    .collection(SESSIONS_COLLECTION)
    .where("uid", "==", uid)
    .where("saved", "==", true)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return snapshot.docs
    .map((doc) => sessionFromFirestore(doc.data()))
    .filter((session) => !isExpired(session))
    .map(summarize);
}
