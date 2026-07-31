import { phaseZeroMetrics, readingFeedback, readingSessions } from "@/lib/reading-store";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { sessionId?: string; value?: string };
    if (!body.sessionId || !["plausible", "uncertain", "not-really"].includes(body.value ?? "")) {
      return Response.json({ ok: false }, { status: 400 });
    }
    if (!readingSessions.has(body.sessionId)) return Response.json({ ok: false }, { status: 404 });
    if (!readingFeedback.has(body.sessionId)) {
      readingFeedback.set(body.sessionId, { value: body.value!, createdAt: Date.now() });
      phaseZeroMetrics.feedbackTotal += 1;
      if (body.value === "plausible") phaseZeroMetrics.plausible += 1;
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
}
