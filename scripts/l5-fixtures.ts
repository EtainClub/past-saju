import { strict as assert } from "node:assert";
import { createReadingSession } from "../src/lib/reading-engine";
import { classifyFork } from "../src/lib/fork/classify";
import { checkFidelity, factIdsOf } from "../src/lib/render/fidelity";
import { validateNarrative, COST_COPY } from "../src/lib/render/template";
import { inRenderSample, llmRenderEnabled, renderWithLlm } from "../src/lib/render/llm";
import { saveReadingSession, saveRenderedResult, selectReadingSession } from "../src/lib/reading-store";
import type { ReadingInput, ReadingResult } from "../src/lib/reading-types";

const STORY = "10년 다닌 회사에서 팀장 승진 제안을 받았지만 거절했습니다.";

function fixture(): ReadingInput {
  return {
    birth: { date: "1991-07-15", calendarType: "solar", lunarLeapMonth: false, time: "09:30", timeUnknown: false, city: "서울", gender: "여성" },
    event: { category: "이직", date: "2021-09", story: STORY, outcome: "결국 퇴사했습니다.", alternative: "" },
    context: { readiness: 3, freedom: 4, fear: 4 },
  };
}

function session() {
  const input = fixture();
  return createReadingSession(input, classifyFork(input));
}

// ── 1. 충실성 검사가 위반을 잡는다 ──────────────────────────────────────────
function fidelityCatchesViolations() {
  const s = session();
  const choice = s.choices[0];
  const spec = choice.narrativeSpec;
  const clean = { result: choice.result, spec, source: STORY, declaredFactIds: factIdsOf(spec), quotedFragments: [] };

  assert.equal(checkFidelity(clean).ok, true, "템플릿 결과는 충실성 검사를 통과해야 합니다.");

  // 지어낸 인용
  const fabricated = checkFidelity({ ...clean, quotedFragments: ["판교에 있는 회사", "연봉 8000만원"] });
  assert.equal(fabricated.ok, false);
  assert.match(fabricated.violations.join(" "), /근거 없는 인용\(2건\)/);

  // 전환점 개월 누락
  const stripped: ReadingResult = { ...choice.result, timeline: choice.result.timeline.map((t) => ({ ...t, text: "개월 수를 말하지 않는 문장." })), overview: ["가", "나"], commonFate: "다" };
  const missing = checkFidelity({ ...clean, result: stripped });
  assert.equal(missing.ok, false);
  assert.match(missing.violations.join(" "), /전환점 개월 누락/);

  // 불변 주제 누락
  const noInvariant = checkFidelity({ ...clean, result: { ...choice.result, commonFate: "아무 말." } });
  assert.equal(noInvariant.ok, false);
  assert.match(noInvariant.violations.join(" "), /불변 주제 누락/);

  // 없는 fact 참조
  const badIds = checkFidelity({ ...clean, declaredFactIds: ["F1", "F99"] });
  assert.equal(badIds.ok, false);
  assert.match(badIds.violations.join(" "), /없는 fact 참조\(F99\)/);
}

// ── 2. 킬스위치가 꺼져 있으면 LLM을 부르지 않는다 ───────────────────────────
function killSwitchDisablesRender() {
  const previousFlag = process.env.LLM_RENDER_ENABLED;
  const previousKey = process.env.ANTHROPIC_API_KEY;

  process.env.LLM_RENDER_ENABLED = "false";
  process.env.ANTHROPIC_API_KEY = "test-key";
  assert.equal(llmRenderEnabled(), false, "플래그가 꺼져 있으면 렌더링하지 않아야 합니다.");

  process.env.LLM_RENDER_ENABLED = "true";
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(llmRenderEnabled(), false, "키가 없으면 렌더링하지 않아야 합니다.");

  if (previousFlag === undefined) delete process.env.LLM_RENDER_ENABLED; else process.env.LLM_RENDER_ENABLED = previousFlag;
  if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previousKey;
}

// ── 3. 샘플링은 세션마다 안정적이다 (재열람 시 경로가 바뀌면 안 된다) ────────
function samplingIsStablePerSession() {
  const previous = process.env.LLM_RENDER_SAMPLE;

  process.env.LLM_RENDER_SAMPLE = "1";
  assert.equal(inRenderSample("any-session"), true);
  process.env.LLM_RENDER_SAMPLE = "0";
  assert.equal(inRenderSample("any-session"), false);

  process.env.LLM_RENDER_SAMPLE = "0.5";
  const ids = Array.from({ length: 40 }, (_, index) => `session-${index}`);
  for (const id of ids) {
    const first = inRenderSample(id);
    for (let repeat = 0; repeat < 5; repeat += 1) {
      assert.equal(inRenderSample(id), first, `${id}의 샘플 판정이 흔들립니다.`);
    }
  }
  const included = ids.filter((id) => inRenderSample(id)).length;
  assert(included > 5 && included < 35, `50% 샘플이 한쪽으로 쏠렸습니다(${included}/40)`);

  if (previous === undefined) delete process.env.LLM_RENDER_SAMPLE; else process.env.LLM_RENDER_SAMPLE = previous;
}

// ── 4. 비활성 상태면 네트워크를 타지 않고 즉시 폴백(null) ───────────────────
async function disabledRenderMakesNoCall() {
  const previousFlag = process.env.LLM_RENDER_ENABLED;
  const previousKey = process.env.ANTHROPIC_API_KEY;
  // 키를 지워 비활성 상태로 만든다. renderWithLlm은 호출부와 별개로 스스로 막아야 한다.
  process.env.LLM_RENDER_ENABLED = "true";
  delete process.env.ANTHROPIC_API_KEY;

  const s = session();
  const choice = s.choices[0];
  const rendered = await renderWithLlm(
    fixture(),
    choice.narrativeSpec,
    s.fork,
    choice.result,
    (candidate) => validateNarrative(choice.narrativeSpec, candidate),
  );
  assert.equal(rendered, null, "비활성 상태에서는 API를 부르지 않고 null이어야 합니다.");

  if (previousFlag === undefined) delete process.env.LLM_RENDER_ENABLED; else process.env.LLM_RENDER_ENABLED = previousFlag;
  if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previousKey;
}

// ── 5. 대가 문장은 코드가 보장한다 (모델 지시에 맡기지 않음) ────────────────
function costSentenceIsGuaranteed() {
  const s = session();
  for (const choice of s.choices) {
    const cost = COST_COPY[choice.narrativeSpec.costPattern];
    assert(
      choice.result.overview.some((paragraph) => paragraph.includes(cost)),
      "대가 문장이 개요에 반드시 있어야 합니다.",
    );
  }
}

// ── 6. 렌더 결과 고정 — 재열람 시 같은 문장이 나온다 ────────────────────────
async function renderedResultIsPinned() {
  const s = session();
  await saveReadingSession(s);

  const first = await selectReadingSession(s.id, 0);
  assert.equal(first.status, "ok");
  assert.equal(first.status === "ok" && first.firstSelection, true, "첫 선택이어야 합니다.");

  const pinned: ReadingResult = { ...s.choices[0].result, commonFate: `${s.choices[0].result.commonFate} [LLM]` };
  await saveRenderedResult(s.id, 0, pinned);

  const second = await selectReadingSession(s.id, 0);
  assert.equal(second.status, "ok");
  assert.equal(second.status === "ok" && second.firstSelection, false, "두 번째는 첫 선택이 아니어야 합니다.");
  assert.equal(
    second.status === "ok" ? second.session.choices[0].result.commonFate : "",
    pinned.commonFate,
    "재열람 시 고정된 결과가 나와야 합니다.",
  );
}

// ── 7. ★ 사용자 원문이 L5까지 닿는다 ────────────────────────────────────────
// 이 검사가 없어서 "패턴 경로에서 evidence가 비는" 결함을 놓쳤다(2026-08-16).
// 패턴이 잘 맞을수록 서사가 덜 개인적이 되는 역설을 막는 관문이다.
function userWordsReachRenderer() {
  const input = fixture();
  const fork = classifyFork(input);
  assert.equal(fork.status, "CLASSIFIED");
  if (fork.status !== "CLASSIFIED") return;

  const quotes = fork.frame.evidence.quotes;
  assert(quotes.length > 0, "패턴으로 분류돼도 원문 발췌가 있어야 합니다.");

  const source = [input.event.story, input.event.outcome, input.event.alternative].filter(Boolean).join("\n");
  for (const quote of quotes) {
    assert(source.includes(quote), `발췌가 원문 부분문자열이어야 합니다: ${quote}`);
  }
  assert(
    quotes.some((quote) => quote.includes("퇴사")),
    "히트한 표현이 들어 있는 문장이 발췌되어야 합니다.",
  );
}

// ── 8. 세션에 fork가 실려 L5가 evidence를 쓸 수 있다 ────────────────────────
function sessionCarriesFork() {
  const s = session();
  assert(s.fork, "세션에 fork 판정이 실려야 합니다.");
  assert.equal(s.fork.status, "CLASSIFIED");
  assert.equal(s.fork.status === "CLASSIFIED" && s.fork.frame.key.domain, "CAREER");
}

async function main() {
  fidelityCatchesViolations();
  killSwitchDisablesRender();
  samplingIsStablePerSession();
  await disabledRenderMakesNoCall();
  costSentenceIsGuaranteed();
  await renderedResultIsPinned();
  userWordsReachRenderer();
  sessionCarriesFork();
  console.log("l5 fixtures: 충실성검사·킬스위치·샘플안정성·실패폴백·대가보장·결과고정·원문전달·fork전달 passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
