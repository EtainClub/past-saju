import { saveReadingFeedback, type FeedbackValue } from "@/lib/reading-store";
import { appCheckResponse, verifyAppCheck } from "@/lib/app-check";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { clientKey, readBoundedBody } from "@/lib/request-guard";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const blocked = appCheckResponse(await verifyAppCheck(request), "feedback");
  if (blocked) return blocked;

  const verdict = await consumeRateLimit("feedback", clientKey(request));
  if (!verdict.ok) return rateLimitResponse(verdict);

  let body: { sessionId?: string; value?: string };
  const raw = await readBoundedBody(request, 4 * 1024);
  try {
    if (raw.status !== "ok") throw new Error(raw.status);
    body = JSON.parse(raw.text) as { sessionId?: string; value?: string };
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
