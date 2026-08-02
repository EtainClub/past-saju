import { saveReadingFeedback, type FeedbackValue } from "@/lib/reading-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { sessionId?: string; value?: string };
  try {
    body = (await request.json()) as { sessionId?: string; value?: string };
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  if (!body.sessionId || !["plausible", "uncertain", "not-really"].includes(body.value ?? "")) {
    return Response.json({ ok: false }, { status: 400 });
  }

  try {
    const result = await saveReadingFeedback(body.sessionId, body.value as FeedbackValue);
    if (result === "missing") return Response.json({ ok: false }, { status: 404 });
    return Response.json({ ok: true, duplicate: result === "duplicate" });
  } catch (error) {
    console.error("Firebase 피드백 저장 실패", error);
    return Response.json({ ok: false }, { status: 503 });
  }
}
