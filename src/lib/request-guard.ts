import { createHash } from "node:crypto";

/**
 * 요청 단위 방어 유틸 — 클라이언트 식별과 본문 크기 상한.
 *
 * 두 가지 모두 LLM 도입(A2) 전에 필요하다. 지금은 남용의 최악이 Firestore 문서
 * 폭주지만, 유료 호출이 붙으면 같은 경로가 곧바로 과금 사고가 된다.
 */

/** 세션 생성 본문 상한. story 600자 + outcome/alternative 각 400자 + 여유. */
export const MAX_BODY_BYTES = 16 * 1024;

/**
 * X-Forwarded-For에서 클라이언트 주소를 고른다.
 *
 * 프록시는 자신이 받은 주소를 **뒤에 덧붙인다.** 따라서 클라이언트가 위조한 값은
 * 앞쪽에 남고, 가장 신뢰할 수 있는 값은 마지막 항목이다. 앞에서 고르면 헤더 한 줄로
 * 속도 제한을 우회할 수 있다.
 *
 * 신뢰 프록시가 여러 단이면 RATE_LIMIT_XFF_DEPTH로 뒤에서 몇 번째인지 지정한다.
 * 값이 실제 인프라와 어긋나면 모든 요청이 같은 키로 묶여 **과차단**된다 —
 * 조용히 열리는 대신 눈에 띄게 막히므로, 배포 후 실측으로 확인할 것.
 */
export function clientKey(request: Request): string {
  const depth = Math.max(1, Number(process.env.RATE_LIMIT_XFF_DEPTH ?? "1") || 1);
  const forwarded = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const address = forwarded[forwarded.length - depth] ?? forwarded[0] ?? "unknown";
  // 원본 IP를 저장하지 않는다. 속도 제한에는 안정적인 식별자면 충분하다.
  return createHash("sha256").update(address).digest("hex").slice(0, 32);
}

export type BodyRead =
  | { status: "ok"; text: string }
  | { status: "too-large" }
  | { status: "unreadable" };

/**
 * 본문을 상한까지만 읽는다. content-length가 없거나 거짓일 수 있으므로
 * 스트림을 직접 누적하면서 상한을 넘는 순간 중단한다.
 */
export async function readBoundedBody(request: Request, limit = MAX_BODY_BYTES): Promise<BodyRead> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) return { status: "too-large" };

  const body = request.body;
  if (!body) {
    const text = await request.text().catch(() => null);
    if (text === null) return { status: "unreadable" };
    return Buffer.byteLength(text) > limit ? { status: "too-large" } : { status: "ok", text };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        return { status: "too-large" };
      }
      chunks.push(value);
    }
  } catch {
    return { status: "unreadable" };
  }

  return { status: "ok", text: Buffer.concat(chunks).toString("utf8") };
}
