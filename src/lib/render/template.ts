import type { FourPillarsDetail } from "manseryeok";
import type { NarrativeSpec, ReadingInput, ReadingResult, TenGodAxis } from "../reading-types";
import { DOMAINS, POLE_LABEL } from "../fork/ontology";
import type { ForkResult } from "../fork/types";

/**
 * L5 — 결정론 템플릿 렌더러.
 *
 * 확정된 NarrativeSpec을 문장으로 옮긴다. 사실 판단은 하지 않는다.
 * LLM 렌더러(A4)가 붙어도 이 경로는 **영구 폴백**으로 남는다.
 */

/** resultFor가 실제로 읽는 필드만. EngineContext가 구조적으로 만족한다. */
export type RenderContext = {
  chart: FourPillarsDetail;
  usefulAxes: TenGodAxis[];
  hostileAxes: TenGodAxis[];
  strengthScore: number;
  strengthBand: "신강" | "신약" | "중간";
  daeunTransition: boolean;
  daeunLabel: string;
  hourConfidence: NarrativeSpec["confidence"]["hourPillar"];
  fork: ForkResult;
};

/**
 * 축별 문안 — 단일 출처.
 *
 * 이전에는 두 벌로 나뉘어 있었다. AXIS_STORY는 gains·losses·vector만,
 * resultFor 내부 stories는 overview·vector만 쓰였고 vector가 양쪽에 중복돼 있었다.
 * 한쪽만 고치면 spec.longTermVector와 타임라인 문장이 조용히 어긋난다.
 */
export const AXIS_COPY: Record<TenGodAxis, {
  title: string;
  phrase: string;
  overview: (category: string, phase: string) => [string, string];
  gains: [string, string, string];
  losses: [string, string, string];
  vector: string;
}> = {
  식상: {
    title: "목소리를 내는 길",
    phrase: "마음을 숨기지 않고, 내가 원하는 변화를 먼저 꺼내 놓는다",
    overview: (category, phase) => [
      `말하지 않았던 것을 밖으로 꺼냈다면, ${category}은 끝맺음보다 새로운 표현의 시작이 되었을 가능성이 큽니다. 처음에는 후련함보다 낯섦이 먼저 왔겠지만, 이전과 같은 방식으로는 돌아가지 않았을 거예요.`,
      `${phase}의 흐름은 빠른 보상보다 방향 전환을 가리킵니다. 내 목소리가 또렷해지는 만큼 익숙한 관계와 규칙에는 마찰이 생기고, 그 대가를 지나야 새 리듬이 자리 잡습니다.`,
    ],
    gains: ["내 감정을 설명하는 언어", "새로운 시도를 끝까지 밀어 보는 힘", "나와 결이 맞는 관계망"],
    losses: ["익숙한 사람들과의 편안한 침묵", "예측 가능한 일상의 속도", "갈등 뒤 회복에 쓰는 시간"],
    vector: "표현의 폭은 넓어지고, 소속의 경계는 더 선명해지는 방향",
  },
  관성: {
    title: "구조를 다시 세우는 길",
    phrase: "당장 떠나기보다 조건과 책임의 경계를 분명히 다시 정한다",
    overview: (category, phase) => [
      `떠나거나 끊기보다 조건을 다시 세웠다면, ${category}은 책임을 떠안는 일이 아니라 책임의 범위를 고르는 일이 되었을 겁니다. 변화는 느리지만 바뀐 규칙은 오래 남았을 가능성이 커요.`,
      `${phase}의 흐름에서는 단단한 구조가 기회와 압박을 함께 만듭니다. 인정은 커지지만 기대도 따라오므로, 모든 일을 잘 해내려는 습관과 거리를 두는 것이 이 세계의 과제가 됩니다.`,
    ],
    gains: ["역할을 분명히 하는 협상력", "흔들리지 않는 실무 기반", "시간이 쌓이며 생기는 신뢰"],
    losses: ["가볍게 방향을 바꿀 여지", "책임에서 완전히 벗어난 휴식", "모두에게 좋은 사람으로 남는 편안함"],
    vector: "사회적 기반은 단단해지고, 책임을 고르는 기준은 까다로워지는 방향",
  },
  재성: {
    title: "실리를 고르는 길",
    phrase: "감정적인 결론을 미루고, 손에 잡히는 조건부터 바꿔 본다",
    overview: (category, phase) => [
      `옳고 그름보다 실제 조건을 먼저 바꿨다면, ${category}의 무게는 한 번에 사라지지 않아도 다룰 수 있는 크기로 작아졌을 겁니다. 작은 합의와 숫자가 감정보다 먼저 길을 냈을 가능성이 커요.`,
      `${phase}의 흐름은 손에 잡히는 성과와 관리 부담이 나란히 커지는 모습입니다. 선택의 효율은 높아지지만, 모든 것을 계산 가능한 문제로 만들지 않는 감각이 필요합니다.`,
    ],
    gains: ["현실적인 선택 기준", "생활의 여유를 만드는 자원", "조건을 조율하는 감각"],
    losses: ["계산하지 않고 몰입하는 순간", "오래 미룰 수 있는 자유", "관계를 효율로 보지 않으려는 여유"],
    vector: "생활의 안정은 커지고, 감정과 효율 사이의 경계가 중요한 방향",
  },
  인성: {
    title: "한 걸음 물러서는 길",
    phrase: "결정을 서두르지 않고, 준비와 회복을 위한 시간을 먼저 확보한다",
    overview: (category, phase) => [
      `결론보다 회복과 준비를 먼저 골랐다면, ${category}은 멈춤이 아니라 시야를 되찾는 유예가 되었을 가능성이 큽니다. 바깥의 변화는 늦지만, 선택을 바라보는 기준은 그 사이 크게 달라졌을 거예요.`,
      `${phase}의 흐름에서는 천천히 모은 정보가 뒤늦게 힘을 냅니다. 다만 준비가 안전지대가 되기 시작하면 다음 문을 여는 일이 더 어려워지므로, 충분함을 정하는 기준이 필요합니다.`,
    ],
    gains: ["나를 소진시키지 않는 속도", "깊어진 판단 기준", "다음 선택을 위한 실질적 준비"],
    losses: ["빠르게 얻을 수 있었던 기회", "주변의 즉각적인 이해", "결정을 미루지 않는 가벼움"],
    vector: "내면의 기준은 깊어지고, 시작을 허락하는 용기는 더 중요해지는 방향",
  },
  비겁: {
    title: "내 힘으로 나서는 길",
    phrase: "익숙한 울타리에서 벗어나, 나만의 방식과 동료를 새로 찾는다",
    overview: (category, phase) => [
      `혼자 감당하는 대신 새로운 동료와 내 방식을 찾았다면, ${category}은 독립과 연대가 동시에 시작되는 지점이 되었을 겁니다. 익숙한 보호는 줄지만 선택의 주도권은 선명해졌을 가능성이 커요.`,
      `${phase}의 흐름에서는 경쟁과 협력이 같은 얼굴로 나타납니다. 누구와 나눌지, 어디까지 내 몫으로 남길지를 배울 때 비로소 자유가 소진으로 바뀌지 않습니다.`,
    ],
    gains: ["내 이름으로 결정하는 주도권", "새로운 동료와의 연결", "실패를 다시 설계하는 탄력"],
    losses: ["익숙한 울타리의 보호", "자원을 혼자 쓰는 여유", "비교하지 않아도 되는 평온"],
    vector: "독립성은 커지고, 좋은 경쟁과 소진을 가르는 안목이 필요한 방향",
  },
};

const STEM_LABELS: Record<string, string> = {
  갑: "갑목(甲木)", 을: "을목(乙木)", 병: "병화(丙火)", 정: "정화(丁火)", 무: "무토(戊土)",
  기: "기토(己土)", 경: "경금(庚金)", 신: "신금(辛金)", 임: "임수(壬水)", 계: "계수(癸水)",
};

/** 대가 문장. LLM 렌더러도 이 문장을 결정론으로 덧붙인다 — 제품 규칙이라 모델에 맡기지 않는다. */
export const COST_COPY: Record<NarrativeSpec["costPattern"], string> = {
  관계소원: "그 과정에서 가까운 관계와 잠시 거리가 생기는 비용은 피하기 어렵습니다.",
  소진건강: "성과를 지키려다 회복의 몫까지 당겨 쓰지 않는 것이 중요합니다.",
  재정압박: "선택을 유지하는 동안에는 자원과 생활비의 압박을 현실적으로 살펴야 합니다.",
  평판마찰: "내 뜻을 드러내는 만큼 주변의 평가와 부딪히는 시기를 지나게 됩니다.",
  정체성혼란: "익숙한 역할을 내려놓는 동안 내가 누구인지 다시 묻는 시간이 따라옵니다.",
};

export function choiceText(axis: TenGodAxis, input: ReadingInput) {
  const base = AXIS_COPY[axis].phrase;
  const category = input.event.category === "기타" ? "그 일" : input.event.category;
  return `${category}의 갈림길에서 ${base}.`;
}

function withTopic(value: string) {
  const last = value.charCodeAt(value.length - 1);
  const hasBatchim = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0;
  return `${value}${hasBatchim ? "은" : "는"}`;
}

function hourConfidenceNote(confidence: NarrativeSpec["confidence"]["hourPillar"]) {
  if (confidence === "unknown") return "태어난 시간을 몰라 시주를 명세에서 제외했어요.";
  if (confidence === "boundary") return "진태양시가 시주 경계에 가까워, 시간에서 온 해석은 낮춰 반영했어요.";
  return "출생지를 진태양시로 보정했고, 시주 경계와 충분히 떨어져 있어요.";
}

function forkNote(fork: ForkResult) {
  if (fork.status !== "CLASSIFIED") {
    return "적어 주신 이야기에서 갈림길의 방향을 확정하지 못해, 명식과 운의 흐름만으로 읽었어요.";
  }
  const { domain, actualChoice, counterfactual } = fork.frame.key;
  return `적어 주신 이야기를 ${DOMAINS[domain].label}의 갈림길로 읽었고, ${POLE_LABEL[actualChoice]}을 택하셨다고 보아 ${POLE_LABEL[counterfactual]}을 이 카드에 반영했어요.`;
}

export function renderReading(axis: TenGodAxis, input: ReadingInput, context: RenderContext, spec: NarrativeSpec): ReadingResult {
  const copy = AXIS_COPY[axis];
  const strength = `${context.strengthBand} 경향 · ${context.strengthScore}`;
  const dayMaster = STEM_LABELS[context.chart.day.heavenlyStem];
  const axisPoints = spec.turningPoints;
  const frictionCount = axisPoints.filter((point) => point.valence === "마찰").length;
  const opportunityCount = axisPoints.filter((point) => point.valence === "기회").length;
  const phase = context.daeunTransition ? "전환" : frictionCount >= 2 && opportunityCount >= 1 ? "혼재" : opportunityCount >= 3 ? "상승" : frictionCount >= 3 ? "하강" : "정체";
  const category = input.event.category === "기타" ? "그 선택" : input.event.category;
  const selectedPoints = [axisPoints[0], axisPoints[1], axisPoints[3]];
  const middlePoint = axisPoints[2];
  const freedom = input.context.freedom;
  const fear = input.context.fear;
  const realityNote = freedom <= 2
    ? "당시 선택의 여지가 좁았다는 현실을 크게 반영했어요."
    : fear >= 4
      ? "무언가를 잃을 수 있다는 두려움이 컸다는 점을 결말의 대가에 반영했어요."
      : "당시의 준비도와 선택 가능성을 균형 있게 반영했어요.";

  const overview = copy.overview(category, phase);
  overview[1] = `${spec.fortunePhase} 국면에서 ${spec.primaryDomain} 영역이 가장 먼저 움직입니다. ${overview[1]} ${COST_COPY[spec.costPattern]}`;
  const timeCopy = [
    `처음 ${selectedPoints[0].monthOffset}개월 무렵에는 선택의 여파가 ${selectedPoints[0].domain}에서 먼저 드러납니다. 속도를 내기보다 바뀐 감각에 이름을 붙이는 시간이었을 거예요.`,
    `${selectedPoints[1].monthOffset}개월째 전후로 ${selectedPoints[1].relation}의 흐름이 강해집니다. 이어 ${middlePoint.monthOffset}개월째에는 ${middlePoint.domain}의 ${middlePoint.relation}이 겹치며, 이 길을 계속 갈 이유를 스스로 다시 정하게 됩니다.`,
    `${selectedPoints[2].monthOffset}개월을 지나면 변화는 사건이 아니라 생활 방식이 됩니다. ${copy.vector}으로 천천히 수렴했을 가능성이 큽니다.`,
  ];
  const invariant = `어느 길을 골라도 ${withTopic(spec.invariantTheme.statement)} 다시 만났을 겁니다. 달라지는 것은 과제의 유무가 아니라, 그것을 알아차리고 다루는 방식입니다.`;
  const pillars = context.chart.toObject();

  return {
    schemaVersion: "2.0",
    title: copy.title,
    choiceText: choiceText(axis, input),
    choiceAxis: axis,
    overview,
    timeline: [
      { label: "3개월의 문턱", month: selectedPoints[0].monthOffset, text: timeCopy[0], tone: "neutral" },
      { label: "1년의 파문", month: selectedPoints[1].monthOffset, text: timeCopy[1], tone: "cool" },
      { label: "3년의 풍경", month: selectedPoints[2].monthOffset, text: timeCopy[2], tone: "warm" },
    ],
    gains: [...spec.gainAxes],
    losses: [...spec.lossAxes],
    commonFate: invariant,
    closingLine: "다른 선택이 더 나은 삶을 약속하지는 않습니다. 다만 지금의 당신이 무엇을 지켜 왔는지는 조금 더 선명하게 보여 줍니다.",
    basis: {
      pillars: input.birth.timeUnknown
        ? `${pillars.year} · ${pillars.month} · ${pillars.day} · 시주 미반영`
        : Object.values(pillars).join(" · "),
      dayMaster,
      strength,
      daeun: context.daeunLabel,
      usefulFlow: `용신 축 ${context.usefulAxes.join("·")} · 기신 축 ${context.hostileAxes.join("·")}`,
      eventFlow: `사건 시점은 ${spec.fortunePhase} 국면으로 읽히며, ${spec.primaryDomain} 영역의 움직임을 가장 크게 반영했어요. ${forkNote(context.fork)}`,
      turningPointsUsed: spec.turningPoints.map((point) => ({ monthOffset: point.monthOffset, label: `${point.domain} ${point.relation}` })),
      realityContext: realityNote,
      hourPillarNote: hourConfidenceNote(context.hourConfidence),
      engineVersion: "saju-1.0-eokbu+manseryeok-2.0.0-kasi",
    },
    uncertaintyNote: "이 글은 정해진 미래나 실제로 일어났을 일을 예측하지 않습니다. 사주 규칙을 바탕으로 지나간 선택을 다른 각도에서 성찰하도록 만든 반사실 서사입니다.",
  };
}

/**
 * 충실성 검사 — 렌더링 결과가 명세를 벗어나지 않았는지.
 * A4의 LLM 렌더러도 같은 관문을 통과해야 한다.
 */
export function validateNarrative(spec: NarrativeSpec, result: ReadingResult) {
  const prose = [...result.overview, ...result.timeline.map((item) => item.text), result.commonFate].join(" ");
  const missingTurns = spec.turningPoints.filter((point) => !prose.includes(`${point.monthOffset}개월`));
  const timelineProse = result.timeline.map((item) => item.text).join(" ");
  const absoluteClaims = ["반드시 일어", "틀림없이", "운명적으로 피할 수 없", "확실한 미래", "병에 걸", "법적으로 해야"];
  const violations = [
    missingTurns.length > 0 && `전환점 ${missingTurns.map((point) => point.monthOffset).join(",")}`,
    !result.overview.some((paragraph) => paragraph.includes(spec.primaryDomain)) && "주요 영역",
    !timelineProse.includes(spec.primaryDomain) && "타임라인 주요 영역",
    spec.gainAxes.some((gain) => !result.gains.includes(gain)) && "얻는 것",
    spec.lossAxes.some((loss) => !result.losses.includes(loss)) && "놓는 것",
    !result.overview.some((paragraph) => paragraph.includes(COST_COPY[spec.costPattern])) && "비용 패턴",
    !result.commonFate.includes(spec.invariantTheme.statement) && "공통 운명",
    absoluteClaims.some((claim) => prose.includes(claim)) && "단정·지시 표현",
    (!result.gains.length || !result.losses.length || prose.includes("후회할 필요가 없")) && "우월 결말",
    result.timeline.length !== 3 && "타임라인 개수",
  ].filter(Boolean);
  if (violations.length) throw new Error(`NarrativeSpec 위반: ${violations.join(" · ")}`);
}
