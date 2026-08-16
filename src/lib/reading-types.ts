import type { ForkResult } from "./fork/types";

export type EventCategory =
  | "이직"
  | "이사"
  | "연애"
  | "진학"
  | "창업"
  | "투자"
  | "가족"
  | "기타";

export type BirthInput = {
  date: string;
  calendarType: "solar" | "lunar";
  lunarLeapMonth: boolean;
  time: string;
  timeUnknown: boolean;
  city: string;
  gender: "남성" | "여성" | "응답 안 함";
};

export type ReadingInput = {
  birth: BirthInput;
  event: {
    category: EventCategory;
    date: string;
    story: string;
    outcome: string;
    alternative: string;
  };
  context: {
    readiness: number;
    freedom: number;
    fear: number;
  };
};

export type TenGodAxis = "식상" | "관성" | "재성" | "인성" | "비겁";
export type Domain = "재물" | "직업·명예" | "관계" | "학습·내면" | "동료·독립" | "표현·창작";

export type TurningPoint = {
  monthOffset: number;
  relation: "충" | "합" | "형" | "용신 활성" | "기신 활성";
  domain: Domain;
  valence: "기회" | "마찰" | "혼재";
  intensity: 1 | 2 | 3 | 4;
};

export type NarrativeSpec = {
  specVersion: "2.0";
  fortunePhase: "상승" | "정체" | "전환" | "하강" | "혼재";
  phaseIntensity: number;
  daeunTransition: boolean;
  primaryDomain: Domain;
  secondaryDomain: Domain;
  turningPoints: TurningPoint[];
  gainAxes: [string, string, string];
  lossAxes: [string, string, string];
  costPattern: "관계소원" | "소진건강" | "재정압박" | "평판마찰" | "정체성혼란";
  longTermVector: string;
  invariantTheme: {
    source: "원국충" | "원국형" | "기신상주" | "십신편중";
    statement: string;
  };
  confidence: {
    hourPillar: "exact" | "boundary" | "unknown";
    strengthBand: "clear" | "moderate";
    overall: number;
  };
};

export type ReadingResult = {
  schemaVersion: "2.0";
  title: string;
  choiceText: string;
  choiceAxis: TenGodAxis;
  overview: string[];
  timeline: Array<{
    label: string;
    month: number;
    text: string;
    tone: "warm" | "cool" | "neutral";
  }>;
  gains: string[];
  losses: string[];
  commonFate: string;
  closingLine: string;
  basis: {
    pillars: string;
    dayMaster: string;
    strength: string;
    daeun: string;
    usefulFlow: string;
    eventFlow: string;
    turningPointsUsed: Array<{ monthOffset: number; label: string }>;
    realityContext: string;
    hourPillarNote: string;
    engineVersion: string;
  };
  uncertaintyNote: string;
};

export type ChoiceSecret = {
  id: string;
  axis: TenGodAxis;
  title: string;
  text: string;
  nonce: string;
  commitment: string;
  narrativeSpec: NarrativeSpec;
  result: ReadingResult;
};

export type ReadingSession = {
  id: string;
  input: ReadingInput;
  createdAt: number;
  /** L2 판정 결과. L5 렌더러가 evidence를 쓰고, 미분류 검토에도 쓰인다. */
  fork: ForkResult;
  selectedSlot?: number;
  completedAt?: number;
  choices: ChoiceSecret[];
  choiceCommitments: string[];
  sessionCommitment: string;
};
