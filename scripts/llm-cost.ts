import { getAnthropic, MODEL } from "../src/lib/llm/client";
import { buildClassifyRequest } from "../src/lib/fork/classify-llm";
import { buildRenderRequest } from "../src/lib/render/llm";
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

/**
 * 단가(USD / 100만 토큰).
 *
 * ⚠ **이 값은 확인이 필요하다.** 코드가 알 수 없는 외부 사실이므로 환경변수로
 * 덮어쓸 수 있게 두었다. 요금 페이지의 값과 다르면 아래 출력의 "비용"은 전부
 * 틀린다 — 토큰 수는 실측이지만 금액은 이 표에 달려 있다.
 *
 * 캐시 쓰기는 기본 입력보다 비싸고(1.25배), 캐시 읽기는 훨씬 싸다(0.1배).
 * 정확한 배수도 요금 페이지에서 확인할 것.
 */
const PRICE = {
  input: Number(process.env.PRICE_INPUT_PER_MTOK ?? "15"),
  output: Number(process.env.PRICE_OUTPUT_PER_MTOK ?? "75"),
  cacheWrite: Number(process.env.PRICE_CACHE_WRITE_PER_MTOK ?? "18.75"),
  cacheRead: Number(process.env.PRICE_CACHE_READ_PER_MTOK ?? "1.5"),
};
const PRICE_CONFIRMED = process.env.PRICE_CONFIRMED === "true";

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

function usd(tokens: number, perMtok: number) {
  return (tokens / 1_000_000) * perMtok;
}

function fmt(amount: number) {
  return `$${amount.toFixed(5)}`;
}

async function countInputs(): Promise<Counted[]> {
  const client = getAnthropic();
  const rows: Counted[] = [];

  for (const sample of SAMPLES) {
    const session = createReadingSession(sample.input);
    const choice = session.choices[0];

    // count_tokens 는 생성 파라미터를 받지 않는다. 토큰 수에 영향을 주는
    // system/messages 만 넘긴다.
    const classify = buildClassifyRequest(sample.input);
    const render = buildRenderRequest(sample.input, choice.narrativeSpec, session.fork);

    const [l2, l5] = await Promise.all([
      client.beta.messages.countTokens({ model: MODEL, system: classify.system, messages: classify.messages }),
      client.beta.messages.countTokens({ model: MODEL, system: render.system, messages: render.messages }),
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
    const choice = session.choices[0];

    const started = Date.now();
    const l2 = await client.beta.messages.create(buildClassifyRequest(sample.input));
    const l2Elapsed = Date.now() - started;

    const renderStarted = Date.now();
    const stream = client.beta.messages.stream(buildRenderRequest(sample.input, choice.narrativeSpec, session.fork));
    const l5 = await stream.finalMessage();
    const l5Elapsed = Date.now() - renderStarted;

    const cost = (u: typeof l2.usage) =>
      usd(u.input_tokens ?? 0, PRICE.input)
      + usd(u.output_tokens ?? 0, PRICE.output)
      + usd(u.cache_creation_input_tokens ?? 0, PRICE.cacheWrite)
      + usd(u.cache_read_input_tokens ?? 0, PRICE.cacheRead);

    const line = (name: string, u: typeof l2.usage, ms: number) =>
      `  ${name}  입력 ${String(u.input_tokens ?? 0).padStart(6)}  출력 ${String(u.output_tokens ?? 0).padStart(6)}`
      + `  캐시쓰기 ${String(u.cache_creation_input_tokens ?? 0).padStart(6)}  캐시읽기 ${String(u.cache_read_input_tokens ?? 0).padStart(6)}`
      + `  ${fmt(cost(u))}  ${(ms / 1000).toFixed(1)}s`;

    console.log(sample.label);
    console.log(line("L2", l2.usage, l2Elapsed));
    console.log(line("L5", l5.usage, l5Elapsed));
    console.log(`  세션 합계  ${fmt(cost(l2.usage) + cost(l5.usage))}  ${((l2Elapsed + l5Elapsed) / 1000).toFixed(1)}s\n`);
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
  const choice = session.choices[0];
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
    const cost = usd(u.input_tokens ?? 0, PRICE.input)
      + usd(u.output_tokens ?? 0, PRICE.output)
      + usd(u.cache_creation_input_tokens ?? 0, PRICE.cacheWrite)
      + usd(u.cache_read_input_tokens ?? 0, PRICE.cacheRead);

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
    const outputCost = usd(u.output_tokens ?? 0, PRICE.output);

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
  console.log("  세션 1건 = L5 1회 + (패턴 미히트 시) L2 1회");
  console.log(`  → 상한에 닿는 세션 수는 패턴 히트율에 달려 있다: ${budget}건(전부 히트) ~ ${Math.floor(budget / 2)}건(전부 미스)`);
  console.log("\n  위 실호출의 '세션 합계'에 이 세션 수를 곱하면 일 최대 지출이다.");
  console.log("  재시도(최대 1회)와 폴백 실패분도 호출을 소비하므로 실제는 더 위다.");
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY 가 없습니다. --env-file=.env.local 을 붙이십시오.");
    process.exit(1);
  }

  console.log(`모델 ${MODEL}\n`);
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
  } else {
    console.log("\n출력 토큰은 생성해 봐야 압니다. thinking 토큰이 출력에 합산 과금되므로");
    console.log("추정하지 않습니다. 실측하려면 --live 를 붙이십시오(과금됨).");
  }

  console.log("\n=== 단가표 (USD / 1M tok) ===");
  console.log(`  입력 ${PRICE.input} · 출력 ${PRICE.output} · 캐시쓰기 ${PRICE.cacheWrite} · 캐시읽기 ${PRICE.cacheRead}`);
  if (!PRICE_CONFIRMED) {
    console.log("\n  ⚠ 이 단가는 **확인되지 않았습니다.** 위 금액은 전부 이 표에 달려 있습니다.");
    console.log("    토큰 수는 실측이지만 금액은 아닙니다. 요금 페이지와 대조한 뒤");
    console.log("    PRICE_CONFIRMED=true 와 PRICE_*_PER_MTOK 를 설정하십시오.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
