import type { ReadingSession } from "./reading-types";

const globalForSessions = globalThis as unknown as {
  pastSajuSessions?: Map<string, ReadingSession>;
  pastSajuFeedback?: Map<string, { value: string; createdAt: number }>;
  pastSajuMetrics?: { sessionsStarted: number; cardsSelected: number; readingsCompleted: number; plausible: number; feedbackTotal: number };
};

export const readingSessions = globalForSessions.pastSajuSessions ?? new Map<string, ReadingSession>();
export const readingFeedback = globalForSessions.pastSajuFeedback ?? new Map<string, { value: string; createdAt: number }>();
export const phaseZeroMetrics = globalForSessions.pastSajuMetrics ?? { sessionsStarted: 0, cardsSelected: 0, readingsCompleted: 0, plausible: 0, feedbackTotal: 0 };

globalForSessions.pastSajuSessions = readingSessions;
globalForSessions.pastSajuFeedback = readingFeedback;
globalForSessions.pastSajuMetrics = phaseZeroMetrics;

export function pruneSessions() {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const [id, session] of readingSessions) {
    if (session.createdAt < cutoff) {
      readingSessions.delete(id);
      readingFeedback.delete(id);
    }
  }
}
