import type { ReadingInput } from "../reading-types";
import { FALLBACK_BETA, MODEL, getAnthropic, serverFallbackEnabled } from "../llm/client";
import { recordLlmUsage } from "../llm/budget";
import { CATEGORY_HINT, DOMAINS, POLARITY_POLES, oppositePole } from "./ontology";
import { groundEvidence } from "./evidence";
import type { DomainId, ForkResult, PolarityValue } from "./types";

/**
 * L2 2단계 — LLM 폴백.
 *
 * 패턴 매칭이 실패했을 때만 호출한다. 모델은 **온톨로지에 정의된 enum 중에서만**
 * 고를 수 있고, 발췌는 원문에 실재해야 한다. 그 밖의 것은 만들 수 없다.
 *
 * 실패·거절·형식 위반은 전부 UNKNOWN으로 떨어진다. 임의 기본값을 만들지 않는다.
 */

export const LLM_CONFIDENCE_FLOOR = 0.7;

const DOMAIN_IDS = Object.keys(DOMAINS) as DomainId[];
const POLE_VALUES = [...new Set(Object.values(POLARITY_POLES).flat())] as PolarityValue[];

const SCHEMA = {
  type: "object",
  properties: {
    domain: { type: "string", enum: DOMAIN_IDS },
    actualChoice: { type: "string", enum: POLE_VALUES },
    confidence: { type: "number" },
    subject: { anyOf: [{ type: "string" }, { type: "null" }] },
    stakes: { type: "array", items: { type: "string" } },
    constraint: { anyOf: [{ type: "string" }, { type: "null" }] },
    quotes: { type: "array", items: { type: "string" } },
  },
  required: ["domain", "actualChoice", "confidence", "subject", "stakes", "constraint", "quotes"],
  additionalProperties: false,
} as const;

/** 안정 프리픽스 — 요청마다 바뀌지 않으므로 프롬프트 캐시에 올린다. */
const SYSTEM_PROMPT = `당신은 사용자가 쓴 과거의 갈림길 서술을 정해진 분류 체계로 접는 일을 합니다.
문장을 쓰거나 해석하지 않습니다. 분류와 발췌만 합니다.

# 도메인
${DOMAIN_IDS.map((id) => `- ${id} (${DOMAINS[id].label}): 극성 축 ${DOMAINS[id].polarityAxis} — ${POLARITY_POLES[DOMAINS[id].polarityAxis].join(" 또는 ")}`).join("\n")}

# 극의 뜻
- LEAVE: 있던 자리를 떠남 / STAY: 그 자리에 남음
- EXPAND: 벌이거나 넓힘 / CONTRACT: 접거나 줄임
- JOIN: 관계를 잇거나 맺음 / SEPARATE: 관계를 끊거나 정리함

# 판정 규칙
1. domain은 반드시 위 목록에서 고릅니다.
2. actualChoice는 **사용자가 실제로 택한 극**입니다. 가지 않은 쪽이 아닙니다.
   해당 도메인의 극성 축에 속한 값이어야 합니다.
3. "실제로는 어떻게 되었나요" 항목이 있으면 그것이 가장 강한 근거입니다.
   "가지 않은 선택" 항목은 택하지 않은 쪽을 서술하므로 반대로 읽습니다.
4. 어느 극인지 확신할 수 없으면 confidence를 0.5 이하로 두십시오.
   추측해서 채우지 마십시오. 낮은 confidence는 정상적인 답입니다.

# 발췌 규칙 (엄수)
subject, stakes, constraint, quotes의 모든 문자열은 **사용자 원문에서 그대로 잘라낸
연속된 조각**이어야 합니다. 요약·바꿔쓰기·일반화·맞춤법 교정을 하지 마십시오.
원문에 없는 지명·금액·인물·날짜를 절대 만들지 마십시오.
적당한 조각이 없으면 null 또는 빈 배열을 반환하십시오.

- subject: 갈림길의 대상 (예: 다니던 곳, 만나던 사람을 가리키는 원문 조각)
- stakes: 걸려 있던 것 (최대 3개)
- constraint: 선택을 좁혔던 제약
- quotes: 서사에 인용할 만한 조각 (최대 3개)`;

type LlmClassification = {
  domain: DomainId;
  actualChoice: PolarityValue;
  confidence: number;
  subject: string | null;
  stakes: string[];
  constraint: string | null;
  quotes: string[];
};

function userBlock(input: ReadingInput) {
  const { category, story, outcome, alternative } = input.event;
  const hint = CATEGORY_HINT[category];
  return [
    `사용자가 고른 분류: ${category}${hint ? ` (도메인 후보: ${hint})` : ""}`,
    `그때의 이야기:\n${story}`,
    outcome ? `실제로는 어떻게 되었나:\n${outcome}` : "실제 결과: (미입력)",
    alternative ? `가지 않은 선택:\n${alternative}` : "가지 않은 선택: (미입력)",
  ].join("\n\n");
}

function parsePayload(raw: string): LlmClassification | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Partial<LlmClassification>;

  // 스키마가 강제하지만, enum 밖의 값이 오면 여기서 다시 떨어뜨린다.
  if (!value.domain || !DOMAIN_IDS.includes(value.domain)) return null;
  if (!value.actualChoice || !POLE_VALUES.includes(value.actualChoice)) return null;
  if (typeof value.confidence !== "number" || Number.isNaN(value.confidence)) return null;

  // 극이 해당 도메인의 축에 속하지 않으면 무효다 (예: CAREER인데 JOIN).
  const poles = POLARITY_POLES[DOMAINS[value.domain].polarityAxis];
  if (!poles.includes(value.actualChoice)) return null;

  return {
    domain: value.domain,
    actualChoice: value.actualChoice,
    confidence: Math.max(0, Math.min(1, value.confidence)),
    subject: typeof value.subject === "string" ? value.subject : null,
    stakes: Array.isArray(value.stakes) ? value.stakes.filter((item): item is string => typeof item === "string") : [],
    constraint: typeof value.constraint === "string" ? value.constraint : null,
    quotes: Array.isArray(value.quotes) ? value.quotes.filter((item): item is string => typeof item === "string") : [],
  };
}

function intensityFrom(context: ReadingInput["context"]): 1 | 2 | 3 {
  const raw = context.readiness + context.freedom;
  if (raw <= 4) return 1;
  if (raw <= 7) return 2;
  return 3;
}

/**
 * 실제로 나가는 요청 본문. 분류기와 단가 실측(`scripts/llm-cost.ts`)이 **같은 것**을
 * 쓴다 — 스크립트가 프롬프트를 따로 들고 있으면 실측값이 실제 비용과 무관해진다.
 */
export function buildClassifyRequest(input: ReadingInput) {
  return {
    model: MODEL,
    max_tokens: 4096,
    output_config: { effort: "low" as const, format: { type: "json_schema" as const, schema: SCHEMA } },
    system: [{ type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } }],
    messages: [{ role: "user" as const, content: userBlock(input) }],
    ...(serverFallbackEnabled() ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
  };
}

export async function classifyForkWithLlm(input: ReadingInput): Promise<ForkResult> {
  let text: string;
  try {
    const response = await getAnthropic().beta.messages.create(buildClassifyRequest(input));

    // 계량은 성공·거절 어느 쪽이든 한다. 돈은 이미 나갔다.
    await recordLlmUsage("l2", response.usage);

    // 안전 분류기가 거절하면 content를 읽기 전에 걸러야 한다.
    if (response.stop_reason === "refusal") return { status: "UNKNOWN", reason: "llm-refusal" };

    const block = response.content.find((item) => item.type === "text");
    if (!block || block.type !== "text") return { status: "UNKNOWN", reason: "llm-no-text" };
    text = block.text;
  } catch (error) {
    console.error("L2 LLM 분류 실패", error);
    return { status: "UNKNOWN", reason: "llm-error" };
  }

  const parsed = parsePayload(text);
  if (!parsed) return { status: "UNKNOWN", reason: "llm-schema-violation" };
  if (parsed.confidence < LLM_CONFIDENCE_FLOOR) return { status: "UNKNOWN", reason: "llm-low-confidence" };

  const source = [input.event.story, input.event.outcome, input.event.alternative].filter(Boolean).join("\n");
  const { evidence } = groundEvidence(
    { subject: parsed.subject, stakes: parsed.stakes, constraint: parsed.constraint, quotes: parsed.quotes },
    source,
  );

  const polarityAxis = DOMAINS[parsed.domain].polarityAxis;
  const [year, month] = input.event.date.split("-").map(Number);
  return {
    status: "CLASSIFIED",
    frame: {
      key: {
        domain: parsed.domain,
        polarityAxis,
        actualChoice: parsed.actualChoice,
        counterfactual: oppositePole(polarityAxis, parsed.actualChoice),
        intensity: intensityFrom(input.context),
        timepoint: { year, month },
        confidence: parsed.confidence,
        source: "llm",
      },
      evidence,
    },
  };
}
