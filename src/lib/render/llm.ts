import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdminFirestore } from "../firebase-admin";
import { FALLBACK_BETA, MODEL, getAnthropic, serverFallbackEnabled } from "../llm/client";
import { reserveLlmCall } from "../llm/budget";
import type { NarrativeSpec, ReadingInput, ReadingResult } from "../reading-types";
import type { ForkResult } from "../fork/types";
import { COST_COPY } from "./template";
import { checkFidelity, factIdsOf } from "./fidelity";

/**
 * L5 — LLM 렌더링.
 *
 * 모델은 **확정된 Fact를 문장으로 옮기는 일만** 한다. 원본 명식은 주지 않는다.
 * 제품 규칙(대가 명시·불변 주제·주요 영역)은 프롬프트가 아니라 **코드가 구조적으로**
 * 보장한다 — 지시만으로는 매번 지켜지지 않기 때문이다.
 *
 * 실패·검증 위반은 전부 템플릿 결과로 폴백한다. 사용자는 실패를 보지 않는다.
 */

const MAX_ATTEMPTS = 2; // 최초 1회 + 재생성 1회

export function llmRenderEnabled() {
  if (process.env.LLM_RENDER_ENABLED !== "true") return false;
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * 점진 전환용 샘플링. 세션 id로 결정하므로 같은 세션은 항상 같은 경로를 탄다
 * (재열람 시 카드 내용이 바뀌면 안 된다).
 */
export function inRenderSample(sessionId: string) {
  const ratio = Number(process.env.LLM_RENDER_SAMPLE ?? "1");
  if (!Number.isFinite(ratio) || ratio >= 1) return true;
  if (ratio <= 0) return false;
  // FNV-1a + 최종 믹싱. 접두사가 같은 id들이 한쪽으로 뭉치지 않아야 한다.
  let hash = 2166136261;
  for (let index = 0; index < sessionId.length; index += 1) {
    hash ^= sessionId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  hash = ((hash ^ (hash >>> 16)) >>> 0);
  return (hash % 1000) / 1000 < ratio;
}

const PARAGRAPH = {
  type: "object",
  properties: { text: { type: "string" }, factIds: { type: "array", items: { type: "string" } } },
  required: ["text", "factIds"],
  additionalProperties: false,
} as const;

const SCHEMA = {
  type: "object",
  properties: {
    overview1: PARAGRAPH,
    overview2: PARAGRAPH,
    timeline1: PARAGRAPH,
    timeline2: PARAGRAPH,
    timeline3: PARAGRAPH,
    commonFate: PARAGRAPH,
  },
  required: ["overview1", "overview2", "timeline1", "timeline2", "timeline3", "commonFate"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `당신은 사주 해석 엔진이 확정한 사실을 한국어 산문으로 옮깁니다.
해석하거나 판단하지 않습니다. 주어진 fact 밖의 것을 만들지 않습니다.

# 절대 규칙
- facts와 evidence에 없는 사건·인물·수치·지명·금액·날짜를 만들지 마십시오.
- evidence의 문자열을 인용할 때는 **원문 그대로** 쓰십시오. 바꿔 쓰면 검증에서 떨어집니다.
- 단정적 예언을 하지 마십시오. "~하게 된다" 대신 "~가능성이 읽힙니다", "~했을 겁니다".
- 의료·법률·재무 조언을 하지 마십시오.
- 이 글은 실제로 일어난 일이 아니라 **가지 않은 길의 가정**입니다. 과거 가정형으로 쓰십시오.

# 사용자의 이야기를 반영하십시오 (가장 중요)
userStory는 사용자가 직접 쓴 말입니다. 이 글은 그 사람의 이야기여야 합니다.
- **무엇에 관한 갈림길이었는지 userStory의 구체를 살려 쓰십시오.** "그 선택"처럼 뭉개지 마십시오.
- userStory에 있는 표현을 인용할 때는 **원문 그대로** 옮기십시오(조사·어미까지).
- 단, userStory에 **없는** 사실은 여전히 만들 수 없습니다. 적혀 있는 것만 씁니다.
- facts(개월·영역·국면)는 명식에서 나온 것이고, userStory는 사용자가 겪은 것입니다. 둘을 이어 붙이십시오.

# 문단별 요구
- overview1: 그 선택을 했다면 무엇이 시작되었을지. **userStory의 구체적 상황에 붙여서** 쓰십시오.
- overview2: 그 흐름이 만드는 기회와 압박. **문장 중간에 들어갈 조각**이므로 앞뒤가 이어지도록 쓰십시오.
  costTheme 문장은 시스템이 이 문단 끝에 자동으로 덧붙입니다. **직접 쓰지 마십시오**(중복됩니다).
- timeline1 / timeline2 / timeline3: 각각 해당 fact의 **개월 수를 반드시 숫자로 언급**하십시오
  (예: "4개월 무렵"). timeline1에는 primaryDomain을 언급하십시오.
- commonFate: 어느 길을 골라도 남는 과제. **invariantStatement를 원문 그대로 포함**하십시오.

# factIds
각 문단이 근거로 삼은 fact의 id를 factIds에 적으십시오. 근거가 없으면 빈 배열입니다.

# 톤
차분하고 단정하지 않습니다. 위로하려 들지 말고, 무엇이 달라지고 무엇을 치르는지를 담담히 씁니다.
문단마다 2~4문장. 과장하거나 미화하지 마십시오.`;

type Paragraph = { text: string; factIds: string[] };
type LlmProse = Record<"overview1" | "overview2" | "timeline1" | "timeline2" | "timeline3" | "commonFate", Paragraph>;

function buildPayload(input: ReadingInput, spec: NarrativeSpec, fork: ForkResult) {
  const facts = spec.turningPoints.map((point, index) => ({
    id: `F${index + 1}`,
    monthOffset: point.monthOffset,
    domain: point.domain,
    basis: point.relation,
    valence: point.valence,
  }));
  const evidence = fork.status === "CLASSIFIED" ? fork.frame.evidence : null;
  return {
    narrative_scope: "counterfactual_3y",
    // 사용자가 실제로 쓴 말. 서사가 "내 이야기"로 읽히려면 이게 닿아야 한다.
    // 인용은 반드시 여기 실재하는 문자열이어야 하며, 검증에서 대조한다.
    userStory: {
      category: input.event.category,
      story: input.event.story,
      outcome: input.event.outcome || null,
      alternative: input.event.alternative || null,
    },
    fortunePhase: spec.fortunePhase,
    primaryDomain: spec.primaryDomain,
    secondaryDomain: spec.secondaryDomain,
    longTermVector: spec.longTermVector,
    gains: spec.gainAxes,
    losses: spec.lossAxes,
    costTheme: COST_COPY[spec.costPattern],
    invariantStatement: spec.invariantTheme.statement,
    facts,
    evidence: evidence && (evidence.subject || evidence.quotes.length || evidence.stakes.length)
      ? { subject: evidence.subject, stakes: evidence.stakes, constraint: evidence.constraint, quotes: evidence.quotes }
      : null,
  };
}

function parseProse(raw: string): LlmProse | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const keys = ["overview1", "overview2", "timeline1", "timeline2", "timeline3", "commonFate"] as const;
  const out = {} as LlmProse;
  for (const key of keys) {
    const value = (parsed as Record<string, unknown>)[key] as Partial<Paragraph> | undefined;
    if (!value || typeof value.text !== "string" || !value.text.trim()) return null;
    out[key] = {
      text: value.text.trim(),
      factIds: Array.isArray(value.factIds) ? value.factIds.filter((id): id is string => typeof id === "string") : [],
    };
  }
  return out;
}

/**
 * 템플릿 결과에 LLM 산문을 얹는다.
 *
 * 결정론으로 남기는 것: overview2의 도입 문장과 대가 문장, 타임라인 라벨·개월·톤,
 * 얻는 것·놓는 것, 근거란, 마무리 문구. 모델은 그 사이의 산문만 쓴다.
 */
function merge(base: ReadingResult, prose: LlmProse, spec: NarrativeSpec): ReadingResult {
  const cost = COST_COPY[spec.costPattern];
  // 모델이 대가 문장을 이미 썼으면 덧붙이지 않는다. 지시만으로는 매번 지켜지지 않는다.
  const middle = prose.overview2.text.includes(cost)
    ? prose.overview2.text
    : `${prose.overview2.text} ${cost}`;
  return {
    ...base,
    overview: [
      prose.overview1.text,
      `${spec.fortunePhase} 국면에서 ${spec.primaryDomain} 영역이 가장 먼저 움직입니다. ${middle}`,
    ],
    timeline: base.timeline.map((item, index) => ({
      ...item,
      text: [prose.timeline1, prose.timeline2, prose.timeline3][index].text,
    })),
    commonFate: prose.commonFate.text,
  };
}

async function recordRenderMetric(field: string) {
  if (process.env.NODE_ENV !== "production" && !process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_STORAGE_BACKEND !== "firestore") return;
  try {
    await getFirebaseAdminFirestore()
      .collection("internalMetrics").doc("phase-zero")
      .set({ [field]: FieldValue.increment(1) }, { merge: true });
  } catch (error) {
    console.error("렌더 지표 기록 실패", error);
  }
}

/**
 * 성공하면 LLM 산문이 얹힌 결과, 실패하면 null(호출부가 템플릿을 그대로 쓴다).
 * validate는 호출부가 병합 결과에 대해 한 번 더 돌린다.
 */
export async function renderWithLlm(
  input: ReadingInput,
  spec: NarrativeSpec,
  fork: ForkResult,
  template: ReadingResult,
  validate: (result: ReadingResult) => void,
): Promise<ReadingResult | null> {
  // 유료 경로이므로 호출부와 별개로 여기서도 막는다.
  if (!llmRenderEnabled()) return null;

  const source = [input.event.story, input.event.outcome, input.event.alternative].filter(Boolean).join("\n");
  const payload = JSON.stringify(buildPayload(input, spec, fork), null, 2);
  const knownIds = factIdsOf(spec);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (!(await reserveLlmCall())) {
      await recordRenderMetric("renderFallback_budget");
      return null;
    }
    await recordRenderMetric("renderAttempt");

    let text: string;
    try {
      const stream = getAnthropic().beta.messages.stream({
        model: MODEL,
        max_tokens: 8000,
        output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{
          role: "user",
          content: `아래 사실만으로 여섯 문단을 쓰십시오. 사용 가능한 fact id: ${knownIds.join(", ")}\n\n${payload}`,
        }],
        ...(serverFallbackEnabled() ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
      });
      const message = await stream.finalMessage();
      if (message.stop_reason === "refusal") {
        await recordRenderMetric("renderFallback_refusal");
        return null;
      }
      const block = message.content.find((item) => item.type === "text");
      if (!block || block.type !== "text") {
        await recordRenderMetric("renderFallback_noText");
        return null;
      }
      text = block.text;
    } catch (error) {
      console.error("L5 LLM 렌더링 실패", error);
      await recordRenderMetric("renderFallback_error");
      return null;
    }

    const prose = parseProse(text);
    if (!prose) {
      await recordRenderMetric("renderFidelityFail_schema");
      continue;
    }

    const merged = merge(template, prose, spec);
    const declaredFactIds = Object.values(prose).flatMap((paragraph) => paragraph.factIds);
    const quotedFragments = fork.status === "CLASSIFIED" ? fork.frame.evidence.quotes : [];
    const { ok, violations } = checkFidelity({ result: merged, spec, source, declaredFactIds, quotedFragments });
    if (!ok) {
      await recordRenderMetric("renderFidelityFail_check");
      console.warn(`L5 충실성 위반(시도 ${attempt}): ${violations.join(" · ")}`);
      continue;
    }

    // 1단 관문. 템플릿과 동일한 검사를 병합 결과에도 적용한다.
    try {
      validate(merged);
    } catch (error) {
      await recordRenderMetric("renderFidelityFail_spec");
      console.warn(`L5 명세 위반(시도 ${attempt}): ${(error as Error).message}`);
      continue;
    }

    await recordRenderMetric("renderSucceeded");
    return merged;
  }

  await recordRenderMetric("renderFallback_exhausted");
  return null;
}
