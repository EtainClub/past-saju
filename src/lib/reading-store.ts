import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getFirebaseAdminFirestore } from "./firebase-admin";
import type { ReadingSession } from "./reading-types";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
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

function expiresAt(createdAt: number) {
  return createdAt + SESSION_TTL_MS;
}

function isExpired(session: ReadingSession) {
  return Date.now() >= expiresAt(session.createdAt);
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
    expiresAt: Timestamp.fromMillis(expiresAt(session.createdAt)),
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
