import type { ReadingInput } from "../reading-types";
import { CATEGORY_HINT, DOMAINS, PATTERNS, POLARITY_POLES, oppositePole } from "./ontology";
import type { DomainId, ForkResult, PolarityValue } from "./types";

/** 히트 없이도 카테고리만으로 도메인을 정하지 않기 위한 최소 신뢰도. */
export const CONFIDENCE_FLOOR = 0.6;

/** 카테고리 힌트 가중치. 패턴 한 건(story 2점)보다 약하게 둔다. */
const CATEGORY_WEIGHT = 1.5;

const FIELD_WEIGHT = { outcome: 3, story: 2, alternative: 2 } as const;

/**
 * 공백·문장부호·기호를 제거하고 NFC로 정규화한다.
 * classifySafety의 우회 대응(ROADMAP M1-C)도 같은 정규화를 공유할 수 있다.
 */
export function normalizeText(value: string) {
  return value.normalize("NFC").replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
}

type Hit = { domain: DomainId; pole: PolarityValue; weight: number };

function scan(text: string, weight: number, invert: boolean): Hit[] {
  if (!text) return [];
  const normalized = normalizeText(text);
  const hits: Hit[] = [];
  for (const pattern of PATTERNS) {
    if (!pattern.match.some((needle) => normalized.includes(needle))) continue;
    const axis = DOMAINS[pattern.domain].polarityAxis;
    hits.push({
      domain: pattern.domain,
      pole: invert ? oppositePole(axis, pattern.pole) : pattern.pole,
      weight,
    });
  }
  return hits;
}

/** 대안이 얼마나 살아 있었는가. readiness(준비도) + freedom(선택 여지). */
function intensityFrom(context: ReadingInput["context"]): 1 | 2 | 3 {
  const raw = context.readiness + context.freedom;
  if (raw <= 4) return 1;
  if (raw <= 7) return 2;
  return 3;
}

/**
 * 1단계 결정론 분류. LLM을 호출하지 않는다.
 *
 * outcome은 실제 선택을, alternative는 가지 않은 쪽을 서술하므로
 * alternative에서 나온 극은 뒤집어서 집계한다.
 * 판정이 서지 않으면 임의 기본값을 만들지 않고 UNKNOWN을 반환한다.
 */
export function classifyFork(input: ReadingInput): ForkResult {
  const { story, outcome, alternative, category, date } = input.event;
  const hits = [
    ...scan(story, FIELD_WEIGHT.story, false),
    ...scan(outcome, FIELD_WEIGHT.outcome, false),
    ...scan(alternative, FIELD_WEIGHT.alternative, true),
  ];

  const domainScore = new Map<DomainId, number>();
  for (const hit of hits) domainScore.set(hit.domain, (domainScore.get(hit.domain) ?? 0) + hit.weight);

  const hinted = CATEGORY_HINT[category];
  if (hinted) domainScore.set(hinted, (domainScore.get(hinted) ?? 0) + CATEGORY_WEIGHT);

  const rankedDomains = [...domainScore.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const domain = rankedDomains[0]?.[0];
  if (!domain) return { status: "UNKNOWN", reason: "no-domain-signal" };

  const polarityAxis = DOMAINS[domain].polarityAxis;
  const [poleA, poleB] = POLARITY_POLES[polarityAxis];
  const poleScore = new Map<PolarityValue, number>([[poleA, 0], [poleB, 0]]);
  for (const hit of hits) {
    if (hit.domain !== domain) continue;
    poleScore.set(hit.pole, (poleScore.get(hit.pole) ?? 0) + hit.weight);
  }

  const [top, second] = [...poleScore.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = top[1] + second[1];
  if (total === 0) return { status: "UNKNOWN", reason: "no-polarity-signal" };
  if (top[1] === second[1]) return { status: "UNKNOWN", reason: "polarity-tie" };

  const evidenceFactor = Math.min(1, total / FIELD_WEIGHT.outcome);
  const margin = (top[1] - second[1]) / total;
  const confidence = Math.round(evidenceFactor * (0.5 + 0.5 * margin) * 100) / 100;
  if (confidence < CONFIDENCE_FLOOR) return { status: "UNKNOWN", reason: "low-confidence" };

  const [year, month] = date.split("-").map(Number);
  return {
    status: "CLASSIFIED",
    frame: {
      key: {
        domain,
        polarityAxis,
        actualChoice: top[0],
        counterfactual: oppositePole(polarityAxis, top[0]),
        intensity: intensityFrom(input.context),
        timepoint: { year, month },
        confidence,
        source: "pattern",
      },
      // A1은 패턴만 사용하므로 발췌가 없다. A2(LLM 폴백)에서 채운다.
      evidence: { subject: null, stakes: [], constraint: null, quotes: [] },
    },
  };
}
