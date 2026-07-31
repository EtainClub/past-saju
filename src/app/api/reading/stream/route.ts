import { phaseZeroMetrics, readingSessions } from "@/lib/reading-store";

export const runtime = "nodejs";

const encoder = new TextEncoder();

export async function POST(request: Request) {
  let body: { sessionId?: string; slot?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "invalid-input" }, { status: 400 });
  }

  if (!body.sessionId || !Number.isInteger(body.slot) || body.slot! < 0 || body.slot! > 2) {
    return Response.json({ code: "invalid-input" }, { status: 400 });
  }

  const session = readingSessions.get(body.sessionId);
  if (!session) {
    return Response.json(
      { code: "session-expired", message: "봉인이 만료되었어요. 같은 내용으로 다시 열어 주세요." },
      { status: 404 },
    );
  }

  if (session.selectedSlot !== undefined && session.selectedSlot !== body.slot) {
    return Response.json(
      { code: "already-selected", message: "이미 한 장을 선택했어요. 그 카드의 결과를 다시 열어드릴게요." },
      { status: 409 },
    );
  }

  if (session.selectedSlot === undefined) phaseZeroMetrics.cardsSelected += 1;
  session.selectedSlot = body.slot;
  const choice = session.choices[body.slot!];
  const result = choice.result;
  const chunks = [
    {
      type: "reveal",
      data: {
        slot: body.slot,
        choiceId: choice.id,
        title: choice.title,
        choiceText: choice.text,
        choiceAxis: choice.axis,
        nonce: choice.nonce,
        commitment: choice.commitment,
        sessionId: session.id,
      },
    },
    ...result.overview.map((paragraph, index) => ({ type: "overview", data: { index, paragraph } })),
    ...result.timeline.map((item, index) => ({ type: "timeline", data: { index, item } })),
    { type: "balance", data: { gains: result.gains, losses: result.losses } },
    { type: "commonFate", data: { text: result.commonFate } },
    { type: "basis", data: result.basis },
    { type: "closing", data: { closingLine: result.closingLine, uncertaintyNote: result.uncertaintyNote } },
    { type: "done", data: { schemaVersion: result.schemaVersion } },
  ];

  const stream = new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
        await new Promise((resolve) => setTimeout(resolve, chunk.type === "reveal" ? 420 : 240));
      }
      if (!session.completedAt) {
        session.completedAt = Date.now();
        phaseZeroMetrics.readingsCompleted += 1;
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
