import { markReadingCompleted, selectReadingSession } from "@/lib/reading-store";

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

  let selection;
  try {
    selection = await selectReadingSession(body.sessionId, body.slot!);
  } catch (error) {
    console.error("Firebase 세션 조회 실패", error);
    return Response.json(
      { code: "storage-unavailable", message: "기록 저장소에 잠시 연결할 수 없어요. 잠시 뒤 다시 시도해 주세요." },
      { status: 503 },
    );
  }

  if (selection.status === "missing") {
    return Response.json(
      { code: "session-expired", message: "봉인이 만료되었어요. 같은 내용으로 다시 열어 주세요." },
      { status: 404 },
    );
  }

  if (selection.status === "conflict") {
    return Response.json(
      { code: "already-selected", message: "이미 한 장을 선택했어요. 그 카드의 결과를 다시 열어드릴게요." },
      { status: 409 },
    );
  }

  const session = selection.session;
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
      try {
        await markReadingCompleted(session.id);
      } catch (error) {
        console.error("Firebase 완료 기록 실패", error);
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
