import { markReadingCompleted, saveRenderedResult, selectReadingSession } from "@/lib/reading-store";
import { appCheckResponse, verifyAppCheck } from "@/lib/app-check";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { clientKey, readBoundedBody } from "@/lib/request-guard";
import { inRenderSample, llmRenderEnabled, renderWithLlm } from "@/lib/render/llm";
import { validateNarrative } from "@/lib/render/template";

export const runtime = "nodejs";

const encoder = new TextEncoder();

export async function POST(request: Request) {
  const blocked = appCheckResponse(await verifyAppCheck(request), "reading/stream");
  if (blocked) return blocked;

  const verdict = await consumeRateLimit("stream", clientKey(request));
  if (!verdict.ok) return rateLimitResponse(verdict);

  let body: { sessionId?: string; slot?: number };
  const raw = await readBoundedBody(request, 4 * 1024);
  try {
    if (raw.status !== "ok") throw new Error(raw.status);
    body = JSON.parse(raw.text);
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

  const reveal = {
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
  };

  const bodyChunks = (result: typeof choice.result) => [
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
      const send = (chunk: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));

      // 카드 공개는 먼저 내보낸다. LLM 렌더링은 수십 초가 걸릴 수 있으므로,
      // 그 동안 사용자가 빈 화면을 보지 않도록 한다.
      send(reveal);

      // L5 — 처음 여는 카드만 LLM으로 렌더링한다. 재열람은 고정된 결과를 그대로 낸다.
      // 생성·검증을 다 마친 뒤에 본문을 내보낸다 — 토큰을 미리 흘리면 위반을 발견해도 되돌릴 수 없다.
      let result = choice.result;
      if (selection.firstSelection && llmRenderEnabled() && inRenderSample(session.id)) {
        const rendered = await renderWithLlm(
          session.input,
          choice.narrativeSpec,
          session.fork,
          choice.result,
          (candidate) => validateNarrative(choice.narrativeSpec, candidate),
        );
        if (rendered) {
          result = rendered;
          await saveRenderedResult(session.id, body.slot!, rendered);
        }
      }

      for (const chunk of bodyChunks(result)) {
        send(chunk);
        await new Promise((resolve) => setTimeout(resolve, 240));
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
