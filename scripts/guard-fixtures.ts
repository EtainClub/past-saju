import { strict as assert } from "node:assert";
import { clientKey, readBoundedBody, MAX_BODY_BYTES } from "../src/lib/request-guard";
import { consumeRateLimit, rateLimitResponse, RATE_LIMITS } from "../src/lib/rate-limit";

function requestWith(headers: Record<string, string>, body?: BodyInit) {
  return new Request("https://ifsaju.com/api/reading/session", { method: "POST", headers, body });
}

// ── 1. 클라이언트 식별은 위조에 견뎌야 한다 ─────────────────────────────────
function identityIsSpoofResistant() {
  // 프록시는 자신이 받은 주소를 뒤에 붙인다. 위조값은 앞에 남는다.
  const spoofed = clientKey(requestWith({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" }));
  const honest = clientKey(requestWith({ "x-forwarded-for": "203.0.113.9" }));
  assert.equal(spoofed, honest, "앞쪽 위조값이 아니라 마지막 항목을 써야 합니다.");

  const other = clientKey(requestWith({ "x-forwarded-for": "203.0.113.10" }));
  assert.notEqual(honest, other, "다른 주소는 다른 키여야 합니다.");
  assert.equal(clientKey(requestWith({})), clientKey(requestWith({})), "헤더가 없어도 안정적이어야 합니다.");

  // 원본 IP를 그대로 담지 않는다.
  assert(!honest.includes("203"), "키에 원본 주소가 남으면 안 됩니다.");
  assert.match(honest, /^[0-9a-f]{32}$/, "키는 해시 형태여야 합니다.");
}

// ── 2. XFF 깊이 설정 ────────────────────────────────────────────────────────
function xffDepthIsConfigurable() {
  process.env.RATE_LIMIT_XFF_DEPTH = "2";
  const depth2 = clientKey(requestWith({ "x-forwarded-for": "1.1.1.1, 203.0.113.9, 10.0.0.1" }));
  delete process.env.RATE_LIMIT_XFF_DEPTH;
  const direct = clientKey(requestWith({ "x-forwarded-for": "203.0.113.9" }));
  assert.equal(depth2, direct, "깊이 2면 뒤에서 두 번째를 골라야 합니다.");
}

// ── 3. 본문 크기 상한 ───────────────────────────────────────────────────────
async function bodyIsBounded() {
  const small = await readBoundedBody(requestWith({ "content-type": "application/json" }, JSON.stringify({ a: 1 })));
  assert.equal(small.status, "ok");
  assert.equal((small as { text: string }).text, '{"a":1}');

  const huge = "x".repeat(MAX_BODY_BYTES + 1);
  const declared = await readBoundedBody(requestWith({ "content-length": String(huge.length) }, huge));
  assert.equal(declared.status, "too-large", "content-length로 먼저 걸러야 합니다.");

  // content-length를 신뢰할 수 없는 청크 전송도 상한에서 끊어야 한다.
  const stream = new ReadableStream({
    start(controller) {
      const chunk = new TextEncoder().encode("x".repeat(4096));
      for (let index = 0; index < 8; index += 1) controller.enqueue(chunk);
      controller.close();
    },
  });
  const chunked = await readBoundedBody(
    new Request("https://ifsaju.com/api/reading/session", { method: "POST", body: stream, duplex: "half" } as RequestInit),
  );
  assert.equal(chunked.status, "too-large", "스트림 누적도 상한을 넘으면 끊어야 합니다.");
}

// ── 4. 한도까지 통과, 넘으면 차단 ───────────────────────────────────────────
async function limitBlocksAfterQuota() {
  const key = `test-${Date.now()}-a`;
  const { limit } = RATE_LIMITS.session;
  for (let index = 0; index < limit; index += 1) {
    const verdict = await consumeRateLimit("session", key);
    assert.equal(verdict.ok, true, `${index + 1}번째 요청은 통과해야 합니다.`);
  }
  const blocked = await consumeRateLimit("session", key);
  assert.equal(blocked.ok, false, "한도를 넘으면 차단해야 합니다.");
  assert(!blocked.ok && blocked.retryAfterSeconds > 0, "재시도 시각을 알려 줘야 합니다.");
}

// ── 5. 키와 버킷은 서로 격리된다 ────────────────────────────────────────────
async function bucketsAreIsolated() {
  const keyA = `test-${Date.now()}-b`;
  const keyB = `test-${Date.now()}-c`;
  for (let index = 0; index < RATE_LIMITS.session.limit; index += 1) await consumeRateLimit("session", keyA);
  assert.equal((await consumeRateLimit("session", keyA)).ok, false);
  assert.equal((await consumeRateLimit("session", keyB)).ok, true, "다른 IP는 영향을 받으면 안 됩니다.");
  assert.equal((await consumeRateLimit("feedback", keyA)).ok, true, "다른 버킷은 별도 한도여야 합니다.");
}

// ── 6. 429 응답 계약 ────────────────────────────────────────────────────────
async function responseContract() {
  const response = rateLimitResponse({ ok: false, retryAfterSeconds: 42 });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "42");
  const payload = await response.json();
  assert.equal(payload.code, "rate-limited");
  assert(typeof payload.message === "string" && payload.message.length > 0, "사용자에게 보일 문구가 있어야 합니다.");
}

async function main() {
  identityIsSpoofResistant();
  xffDepthIsConfigurable();
  await bodyIsBounded();
  await limitBlocksAfterQuota();
  await bucketsAreIsolated();
  await responseContract();
  console.log("guard fixtures: 식별자 위조내성·XFF깊이·본문상한·속도제한·격리·429계약 passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
