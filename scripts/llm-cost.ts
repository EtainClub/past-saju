import { getAnthropic, modelFor } from "../src/lib/llm/client";
import { costOf, priceFor, type TokenUsage } from "../src/lib/llm/pricing";
import { buildClassifyRequest } from "../src/lib/fork/classify-llm";
import { buildRenderRequest, merge, parseProse } from "../src/lib/render/llm";
import { checkFidelity } from "../src/lib/render/fidelity";
import { createReadingSession } from "../src/lib/reading-engine";
import type { ReadingInput } from "../src/lib/reading-types";

/**
 * LLM 단가 실측 — §7-8(예산 상한)을 정하기 위한 근거.
 *
 * 지금 예산은 **호출 수**로만 걸려 있다(하루 500회). 호출 수는 세지만 단가를
 * 모르면 "500회면 얼마인가"에 답할 수 없고, 베타 규모도 정할 수 없다.
 *
 * 두 가지를 잰다.
 *   count_tokens  — 입력 토큰. 생성 없이 재므로 **공짜이고 결정론적**이다.
 *   --live        — 실제 호출. 출력 토큰은 생성해 봐야 알 수 있다.
 *                   thinking 토큰이 출력에 합산 과금되므로 추정이 위험하다.
 *
 * 요청 본문은 `buildClassifyRequest` / `buildRenderRequest`를 그대로 쓴다.
 * 프롬프트를 여기에 복사하면 곧 어긋나고, 그러면 실측값이 실제 비용과
 * 무관해진다.
 *
 * 사용법
 *   입력만:  node --env-file=.env.local .test-dist/scripts/llm-cost.js
 *   실호출:  node --env-file=.env.local .test-dist/scripts/llm-cost.js --live
 *
 * ⚠ --live 는 실제로 과금된다. 표본 수만큼 L2+L5가 호출된다.
 */

// 단가는 src/lib/llm/pricing.ts 가 갖는다(2026-08-17 요금 페이지 확인분).
// 모델마다 다르므로 스크립트가 한 벌만 들고 있으면 모델 비교가 성립하지 않는다.

/** 길이가 다른 세 갈래. 서술 길이가 비용을 좌우하므로 짧은·보통·긴 것을 함께 본다. */
const SAMPLES: Array<{ label: string; input: ReadingInput }> = [
  {
    label: "짧은 서술",
    input: {
      birth: { date: "1991-07-15", time: "09:30", timeUnknown: false, calendarType: "solar", lunarLeapMonth: false, city: "서울", gender: "여성" },
      event: { category: "이직", date: "2021-09", story: "다니던 회사를 그만둘지 고민했다.", outcome: "결국 남았습니다.", alternative: "" },
      context: { readiness: 3, freedom: 3, fear: 3 },
    },
  },
  {
    label: "보통 서술",
    input: {
      birth: { date: "1988-03-02", time: "14:20", timeUnknown: false, calendarType: "solar", lunarLeapMonth: false, city: "부산", gender: "남성" },
      event: {
        category: "이직",
        date: "2019-04",
        story: "10년 다닌 회사에서 팀장 승진 제안을 받았습니다. 같은 시기에 작은 회사에서 창업 멤버로 와 달라는 연락이 왔습니다. 두 달을 고민했습니다.",
        outcome: "승진을 받아들이고 남았습니다. 안정이 필요한 시기였습니다.",
        alternative: "그때 창업 쪽으로 갔다면 어땠을까 아직도 생각합니다.",
      },
      context: { readiness: 4, freedom: 2, fear: 4 },
    },
  },
  {
    label: "긴 서술(상한 근처)",
    input: {
      birth: { date: "1975-11-08", time: "", timeUnknown: true, calendarType: "lunar", lunarLeapMonth: false, city: "대구", gender: "여성" },
      event: {
        category: "이사",
        date: "2015-06",
        // 폼 상한은 story 600 / outcome 400 / alternative 400 자다. 비용 상단을 보려면 근처까지 채운다.
        story: "서울에서 15년을 살았습니다. ".repeat(20).slice(0, 580),
        outcome: "결국 고향으로 내려가지 않고 서울에 남았습니다. ".repeat(12).slice(0, 380),
        alternative: "그때 내려갔다면 부모님 곁에 있었을 텐데 하는 생각을 합니다. ".repeat(10).slice(0, 380),
      },
      context: { readiness: 2, freedom: 1, fear: 5 },
    },
  },
];

type Counted = { label: string; l2Input: number; l5Input: number };

function fmt(amount: number | null) {
  return amount === null ? "단가미상" : `$${amount.toFixed(5)}`;
}

type Usage = TokenUsage;

/**
 * 비교용 카드 선택 — **결정론이어야 한다.**
 *
 * `choices[0]`을 쓰면 안 된다. 카드 슬롯 배치는 봉인 UX상 난수라
 * (`reading-engine.ts`의 randomBytes), 실행마다 다른 축이 뽑힌다.
 * 그러면 모델마다 **다른 명세로 쓴 글**을 나란히 놓고 품질을 비교하게 된다.
 * 실제로 그렇게 잘못 비교했다 — Opus는 동료·독립, Sonnet은 학습·내면이었다.
 */
function fixedChoice(session: ReturnType<typeof createReadingSession>) {
  return [...session.choices].sort((a, b) => a.axis.localeCompare(b.axis))[0];
}

/** 단가를 모르면 0이 아니라 null. 0은 "공짜"로 읽혀 더 나쁘다. */
function money(model: string, usage: Usage) {
  return costOf(model, usage);
}

/** 합계 누적. 하나라도 단가를 모르면 합계 전체가 미상이 된다. */
function addMoney(sum: number | null, next: number | null) {
  return sum === null || next === null ? null : sum + next;
}

const CANDIDATES = (process.env.LLM_COMPARE_MODELS ?? "claude-opus-5,claude-sonnet-5,claude-haiku-4-5-20251001")
  .split(",").map((item) => item.trim()).filter(Boolean);

/** measureLive() 가 채운다. projectBudget() 이 추정 대신 실측으로 환산한다. */
const sessionCosts: number[] = [];

async function countInputs(): Promise<Counted[]> {
  const client = getAnthropic();
  const rows: Counted[] = [];

  for (const sample of SAMPLES) {
    const session = createReadingSession(sample.input);
    const choice = fixedChoice(session);

    // count_tokens 는 생성 파라미터를 받지 않는다. 토큰 수에 영향을 주는
    // system/messages 만 넘긴다.
    const classify = buildClassifyRequest(sample.input);
    const render = buildRenderRequest(sample.input, choice.narrativeSpec, session.fork);

    // 모델은 요청이 정한 것을 그대로 쓴다. 층마다 다르므로 상수를 쓰면 어긋난다.
    const [l2, l5] = await Promise.all([
      client.beta.messages.countTokens({ model: classify.model, system: classify.system, messages: classify.messages }),
      client.beta.messages.countTokens({ model: render.model, system: render.system, messages: render.messages }),
    ]);

    rows.push({ label: sample.label, l2Input: l2.input_tokens, l5Input: l5.input_tokens });
  }
  return rows;
}

async function measureLive() {
  const client = getAnthropic();
  console.log("\n=== 실호출 (--live) — 실제로 과금됩니다 ===\n");

  for (const sample of SAMPLES) {
    const session = createReadingSession(sample.input);
    const choice = fixedChoice(session);

    const classifyRequest = buildClassifyRequest(sample.input);
    const renderRequest = buildRenderRequest(sample.input, choice.narrativeSpec, session.fork);

    const started = Date.now();
    const l2 = await client.beta.messages.create(classifyRequest);
    const l2Elapsed = Date.now() - started;

    const renderStarted = Date.now();
    const stream = client.beta.messages.stream(renderRequest);
    const l5 = await stream.finalMessage();
    const l5Elapsed = Date.now() - renderStarted;

    // 단가는 층마다 다르다 — 요청이 쓴 모델로 계산해야 한다.
    const line = (name: string, model: string, u: Usage, ms: number) =>
      `  ${name}  입력 ${String(u.input_tokens ?? 0).padStart(6)}  출력 ${String(u.output_tokens ?? 0).padStart(6)}`
      + `  캐시쓰기 ${String(u.cache_creation_input_tokens ?? 0).padStart(6)}  캐시읽기 ${String(u.cache_read_input_tokens ?? 0).padStart(6)}`
      + `  ${fmt(money(model, u))}  ${(ms / 1000).toFixed(1)}s`;

    console.log(`${sample.label}`);
    console.log(line("L2", classifyRequest.model, l2.usage, l2Elapsed));
    console.log(line("L5", renderRequest.model, l5.usage, l5Elapsed));
    const total = addMoney(money(classifyRequest.model, l2.usage), money(renderRequest.model, l5.usage));
    console.log(`  세션 합계  ${fmt(total)}  ${((l2Elapsed + l5Elapsed) / 1000).toFixed(1)}s\n`);
    if (total !== null) sessionCosts.push(total);
  }
}

/**
 * effort 스윕 — 비용과 지연을 동시에 좌우하는 유일한 레버.
 *
 * 현재 L5는 effort "medium"이고 지연이 16~22초다(§5.4-a). 출력 토큰이
 * 실제 산문 분량보다 훨씬 큰데, 차이는 thinking이다. effort를 낮추면
 * **비용과 지연이 함께** 내려간다. 남는 질문은 품질뿐이고, 그건 사람이 본다.
 *
 * 그래서 이 함수는 판정하지 않고 **산문을 그대로 찍는다.** 숫자만 보고
 * "low가 싸니까 low"로 정하면, 정작 제품 가치인 서사 품질을 못 보고 정하는 것이다.
 */
async function sweepEffort() {
  const client = getAnthropic();
  const sample = SAMPLES[1]; // 보통 서술 — 실사용 분포의 중앙에 가깝다
  const session = createReadingSession(sample.input);
  const choice = fixedChoice(session);
  const base = buildRenderRequest(sample.input, choice.narrativeSpec, session.fork);

  console.log(`\n=== effort 스윕 (L5) — "${sample.label}" 고정, 실제로 과금됩니다 ===\n`);

  // 캐시를 먼저 데운다. 첫 호출은 캐시 **쓰기**(입력의 1.25배)를 물고, 이후는
  // **읽기**(0.1배)를 문다. 데우지 않으면 첫 effort만 부당하게 비싸게 나와
  // 비용 비교가 통째로 오염된다 — 실제로 그렇게 잘못 쟀다.
  process.stdout.write("  캐시 예열 중… ");
  await client.beta.messages.stream({ ...base, max_tokens: 64 }).finalMessage().catch(() => null);
  console.log("완료\n");

  console.log("  effort  출력tok  산문자수   출력비용    총비용   지연");
  for (const effort of ["low", "medium", "high"] as const) {
    const started = Date.now();
    const stream = client.beta.messages.stream({
      ...base,
      output_config: { ...base.output_config, effort },
    });
    const message = await stream.finalMessage();
    const elapsed = Date.now() - started;
    const u = message.usage;
    const cost = money(base.model, u);

    const block = message.content.find((item) => item.type === "text");
    const text = block && block.type === "text" ? block.text : "";
    let prose = "";
    try {
      const parsed = JSON.parse(text) as Record<string, { text?: string }>;
      prose = parsed.overview1?.text ?? "";
    } catch {
      prose = "(JSON 파싱 실패)";
    }
    // 산문 토큰과 출력 토큰의 차이가 곧 thinking 분량이다.
    const proseChars = Object.values(
      (() => { try { return JSON.parse(text) as Record<string, { text?: string }>; } catch { return {}; } })(),
    ).reduce((sum, item) => sum + (item?.text?.length ?? 0), 0);

    // effort가 직접 좌우하는 건 출력이다. 입력·캐시는 effort와 무관하므로
    // 비교는 출력 비용으로 해야 왜곡이 없다.
    const price = priceFor(base.model);
    const outputCost = price ? ((u.output_tokens ?? 0) / 1_000_000) * price.output : null;

    console.log(
      `  ${effort.padEnd(7)}${String(u.output_tokens ?? 0).padStart(6)}`
      + `${String(proseChars).padStart(9)}   ${fmt(outputCost)}  ${fmt(cost)}  ${(elapsed / 1000).toFixed(1)}s`,
    );
    console.log(`    개요1: ${prose}\n`);
  }

  console.log("  출력 tok 에는 thinking 이 합산되어 있다. 산문 자수와 함께 보면");
  console.log("  effort 가 '생각'을 늘리는지 '분량'을 늘리는지 갈린다.");
  console.log("\n품질은 숫자로 안 나옵니다. 위 개요1을 읽고 정하십시오.");
}

/**
 * 모델 비교 — L5를 Opus 말고 값싼 모델로 내려도 되는가.
 *
 * 숫자만으로는 못 정한다. 이 서비스에서 서사는 **제품 가치 자체**라서,
 * 싸고 빠르지만 밋밋하면 도입 의미가 없다. 그래서 셋을 함께 낸다.
 *
 *   비용·지연  — 잴 수 있다
 *   충실성 통과 — 잴 수 있다. 실제 `checkFidelity`를 돌린다. 떨어지면
 *                운영에서 템플릿으로 폴백하므로 **폴백률이 곧 품질 하한**이다
 *   산문        — 못 잰다. 그대로 찍어서 사람이 읽는다
 *
 * 표본 3건이라 폴백률은 경향만 본다. 확정은 실트래픽이다.
 */
async function compareModels(layer: "l2" | "l5", models: string[]) {
  const client = getAnthropic();
  console.log(`\n=== 모델 비교 (${layer.toUpperCase()}) — 실제로 과금됩니다 ===\n`);

  // 산문은 **항상 같은 샘플**을 찍는다. "첫 번째 통과분"을 찍으면 모델마다
  // 다른 입력이 나와 품질 비교가 성립하지 않는다 — 실제로 그렇게 잘못 비교했다.
  const PROSE_SAMPLE = 1; // 보통 서술
  // 충실성은 한 번 돌려선 모른다 — 실제로 Haiku가 2/3과 1/3을 오갔다.
  const repeatArg = process.argv.find((item) => item.startsWith("--repeat="));
  const repeat = Math.max(1, Number(repeatArg?.split("=")[1] ?? "1") || 1);

  for (const model of models) {
    let okCount = 0;
    let costSum: number | null = 0;
    const tokenSum = { input: 0, output: 0 };
    let elapsedSum = 0;
    const failures: string[] = [];
    let sampleProse = "";
    let sampleFull = "";
    let sampleOk = false;
    let attempts = 0;
    let error: string | null = null;

    const plan = Array.from({ length: repeat }, () => SAMPLES.entries()).flatMap((entries) => [...entries]);
    for (const [index, sample] of plan) {
      attempts += 1;
      const session = createReadingSession(sample.input);
      const choice = fixedChoice(session);
      const started = Date.now();

      try {
        if (layer === "l2") {
          const response = await client.beta.messages.create(buildClassifyRequest(sample.input, model));
          costSum = addMoney(costSum, money(model, response.usage));
          elapsedSum += Date.now() - started;
          // L2의 성패는 "분류가 나왔는가"다. 스키마 위반·저신뢰는 UNKNOWN이 된다.
          const block = response.content.find((item) => item.type === "text");
          const text = block && block.type === "text" ? block.text : "";
          const parsed = JSON.parse(text) as { domain?: string; confidence?: number };
          tokenSum.input += response.usage.input_tokens ?? 0;
          tokenSum.output += response.usage.output_tokens ?? 0;
          if (parsed.domain && (parsed.confidence ?? 0) >= 0.7) okCount += 1;
          else failures.push(`저신뢰/미분류(${parsed.confidence ?? "?"})`);
          if (index === PROSE_SAMPLE) sampleProse = `${parsed.domain} conf=${parsed.confidence}`;
          continue;
        }

        const stream = client.beta.messages.stream(
          buildRenderRequest(sample.input, choice.narrativeSpec, session.fork, model),
        );
        const message = await stream.finalMessage();
        costSum = addMoney(costSum, money(model, message.usage));
        tokenSum.input += message.usage.input_tokens ?? 0;
        tokenSum.output += message.usage.output_tokens ?? 0;
        elapsedSum += Date.now() - started;

        const block = message.content.find((item) => item.type === "text");
        const prose = parseProse(block && block.type === "text" ? block.text : "");
        if (!prose) {
          failures.push("스키마 위반");
          if (index === PROSE_SAMPLE) sampleProse = "(스키마 위반으로 산문 없음)";
          continue;
        }
        if (index === PROSE_SAMPLE) {
          sampleProse = prose.overview1.text;
          // 개요1 한 문단으로는 못 정한다. 여섯 문단을 다 보여 준다.
          sampleFull = (["overview1", "overview2", "timeline1", "timeline2", "timeline3", "commonFate"] as const)
            .map((key) => `    [${key}] ${prose[key].text}`).join("\n");
        }

        // 운영과 **같은 관문**을 통과시킨다. 여기서 떨어지면 실제로도 폴백한다.
        const merged = merge(choice.result, prose, choice.narrativeSpec);
        const source = [sample.input.event.story, sample.input.event.outcome, sample.input.event.alternative]
          .filter(Boolean).join("\n");
        const { ok, violations } = checkFidelity({
          result: merged,
          spec: choice.narrativeSpec,
          source,
          declaredFactIds: Object.values(prose).flatMap((paragraph) => paragraph.factIds),
          quotedFragments: session.fork.status === "CLASSIFIED" ? session.fork.frame.evidence.quotes : [],
        });
        if (ok) okCount += 1;
        else failures.push(violations[0] ?? "충실성 위반");
        if (index === PROSE_SAMPLE) sampleOk = ok;
      } catch (caught) {
        error = (caught as Error).message.slice(0, 160);
        break;
      }
    }

    if (error) {
      console.log(`${model}\n  ❌ 호출 실패 — ${error}\n`);
      continue;
    }

    console.log(`${model}`);
    console.log(
      `  충실성 ${okCount}/${attempts}  입력 ${tokenSum.input}tok  출력 ${tokenSum.output}tok`
      + `  평균 ${(elapsedSum / attempts / 1000).toFixed(1)}s  ${fmt(costSum)}`,
    );
    if (failures.length) console.log(`  실패 사유: ${[...new Set(failures)].join(" · ")}`);
    if (layer === "l2") {
      if (sampleProse) console.log(`  분류: ${sampleProse}`);
    } else if (process.argv.includes("--full") && sampleFull) {
      console.log(`  전문[${SAMPLES[PROSE_SAMPLE].label}, ${sampleOk ? "통과" : "탈락"}]`);
      console.log(sampleFull);
    } else if (sampleProse) {
      console.log(`  개요1[${SAMPLES[PROSE_SAMPLE].label}, ${sampleOk ? "통과" : "탈락"}]: ${sampleProse}`);
    }
    console.log();
  }

  if (layer === "l5") {
    console.log("충실성은 하한만 봅니다. **문장이 좋은지는 위 개요1을 읽어야** 압니다.");
    console.log("서사가 이 서비스의 제품 가치 자체이므로, 싸다고 자동으로 이기지 않습니다.");
  }
}

/**
 * 하루 상한이 얼마인지 — §7-8이 실제로 묻는 것.
 *
 * 지금 상한은 "하루 500 호출"이다. 호출당 단가를 알면 그게 금액으로 얼마인지
 * 나온다. 이 숫자를 보고 상한을 다시 정하는 것이 이 스크립트의 목적이다.
 *
 * 실측 세션 비용은 measureLive()가 찍은 값을 쓴다. 여기서 다시 추정하지 않는다.
 */
function projectBudget() {
  const budget = Number(process.env.LLM_DAILY_CALL_BUDGET ?? "500") || 500;
  console.log("\n=== 하루 상한 환산 (§7-8) ===\n");
  console.log(`  현재 상한: ${budget} 호출/일 (LLM_DAILY_CALL_BUDGET)`);
  console.log("  세션 1건 = L5 1회 + (패턴 미히트 시) L2 1회\n");

  if (!sessionCosts.length) {
    console.log("  실호출 표본이 없어 환산할 수 없습니다. --live 를 붙이십시오.");
    return;
  }

  const avg = sessionCosts.reduce((sum, item) => sum + item, 0) / sessionCosts.length;
  const worst = Math.max(...sessionCosts);

  // 상한은 호출 수로 걸린다. 패턴이 다 잡으면 세션당 1호출이라 세션 수가 늘고,
  // 다 놓치면 2호출이라 절반이 된다. 지출은 그 사이 어딘가다.
  const rows: Array<[string, number, number]> = [
    ["패턴 전부 미스 (세션당 L2+L5 2호출)", Math.floor(budget / 2), avg],
    ["패턴 전부 히트 (세션당 L5 1호출)", budget, avg],
    ["패턴 전부 히트 · 최악 표본", budget, worst],
  ];
  console.log("  시나리오                           세션/일     단가      일 최대");
  const daily: number[] = [];
  for (const [label, sessions, unit] of rows) {
    daily.push(sessions * unit);
    console.log(`  ${label.padEnd(33)}${String(sessions).padStart(6)}  ${fmt(unit)}  ${fmt(sessions * unit)}`);
  }
  console.log(`\n  일 지출 범위: ${fmt(Math.min(...daily))} ~ ${fmt(Math.max(...daily))}`);
  console.log(`  월 환산(30일): ${fmt(Math.min(...daily) * 30)} ~ ${fmt(Math.max(...daily) * 30)}`);
  console.log("\n  주의 — 첫 호출은 캐시 **쓰기**를 물어 비싸다. 정상 운영은 캐시 읽기라 위 값보다 낮다.");
  console.log("  반대로 재시도(최대 1회)와 폴백 실패분은 호출을 더 소비한다.");
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY 가 없습니다. --env-file=.env.local 을 붙이십시오.");
    process.exit(1);
  }

  console.log(`모델 — L2 ${modelFor("l2")} · L5 ${modelFor("l5")}\n`);
  console.log("=== 입력 토큰 (count_tokens — 과금 없음) ===\n");

  const rows = await countInputs();
  console.log("  케이스                L2 입력   L5 입력    합계");
  for (const row of rows) {
    const total = row.l2Input + row.l5Input;
    console.log(`  ${row.label.padEnd(20)}${String(row.l2Input).padStart(7)}${String(row.l5Input).padStart(10)}${String(total).padStart(8)}`);
  }

  // L2는 패턴이 잡으면 아예 호출되지 않는다. 최악(전부 LLM)과 실제는 다르다.
  console.log("\n  L2는 패턴 매칭이 잡으면 호출되지 않습니다(비용 0).");
  console.log("  위 숫자는 **패턴이 못 잡았을 때의 상한**입니다.");

  if (process.argv.includes("--live")) {
    await measureLive();
    if (process.argv.includes("--sweep")) await sweepEffort();
    projectBudget();
  } else if (process.argv.includes("--sweep")) {
    await sweepEffort();
  } else if (process.argv.includes("--models")) {
    // --layer=l5 로 한 층만 잴 수 있다. 표본을 늘리면 두 층을 다 도는 게 오래 걸린다.
    const layerArg = process.argv.find((item) => item.startsWith("--layer="))?.split("=")[1];
    if (layerArg !== "l2") await compareModels("l5", CANDIDATES);
    if (layerArg !== "l5") await compareModels("l2", CANDIDATES);
  } else {
    console.log("\n출력 토큰은 생성해 봐야 압니다. thinking 토큰이 출력에 합산 과금되므로");
    console.log("추정하지 않습니다. 실측하려면 --live 를 붙이십시오(과금됨).");
  }

  console.log("\n=== 단가표 (USD / 1M tok, 2026-08-17 요금 페이지) ===");
  for (const model of new Set([modelFor("l2"), modelFor("l5"), ...CANDIDATES])) {
    const price = priceFor(model);
    console.log(price
      ? `  ${model.padEnd(28)} 입력 ${price.input} · 출력 ${price.output} · 캐시쓰기 ${price.cacheWrite} · 캐시읽기 ${price.cacheRead}`
      : `  ${model.padEnd(28)} 단가 미상 — src/lib/llm/pricing.ts 에 추가할 것`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
