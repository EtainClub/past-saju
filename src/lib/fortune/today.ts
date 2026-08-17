import {
  calculateFourPillars,
  getBranchTenGod,
  getTenGod,
  type EarthlyBranch,
  type FiveElement,
} from "manseryeok";
import { DEFAULT_PROFILE } from "../chart/profile";
import { natalChart, natalStrength } from "../chart/natal";
import { axisRole, weighAxes } from "../chart/axis-weight";
import { branchRelation, CONTROLS, PRODUCER, PRODUCES, type BranchRelation } from "../chart/branch-relation";
import { axisFromTenGod } from "../ten-god-axis";
import { resolveSolarBirthDate } from "../birth-date";
import type { BirthInput, TenGodAxis } from "../reading-types";

/**
 * 오늘의 운세 — 일진(日辰)과 원국을 맞대어 낸 하루치 흐름.
 *
 * **LLM 이 없다.** 점수도 문장도 코드가 만든다. 이유는 셋이다.
 *   1) 매일 여는 화면이라 호출당 비용이 방문 수만큼 곱해진다(§4 비용 통제).
 *   2) 같은 날 같은 사람에게 두 번 다른 말을 하면 안 된다 — 결정론이면 캐시가 필요 없다.
 *   3) 검증이 가능하다. 충이 들었는데 "무난"이라 말하는 일은 픽스처가 잡는다.
 *
 * 「내 사주」와의 경계: 그 화면은 계산만 보여 주고 길흉을 말하지 않는다.
 * 이 화면은 **길흉을 말하는 별도 화면**이다. 두 화면을 섞지 않는 것이
 * docs/CHART-LLM-EXPANSION.md §4 가 지키라고 한 선이다.
 *
 * 근거는 전부 명식에서 나온다:
 *   · 오늘 천간·지지가 일간에게 오는 십신 → 용신이면 순풍, 기신이면 역풍
 *   · 오늘 지지와 원국 각 궁(년·월·일·시)의 충·합·형
 *   · 공망(空亡) — 오늘 지지가 원국 공망에 걸리는가
 */

export type FortuneDomain = "총운" | "애정" | "재물" | "성취";
export type FortuneBand = "아주 좋음" | "좋음" | "무난" | "조심";

export type FortuneScore = {
  domain: FortuneDomain;
  /** 5~95. 0·100 을 쓰지 않는 것은 확정을 말하지 않기 위해서다. */
  score: number;
  stars: number;
  band: FortuneBand;
  headline: string;
  detail: string;
};

export type PalaceHit = {
  palace: "년지" | "월지" | "일지" | "시지";
  /** 그 궁이 뜻하는 자리. 근거를 사람 말로 옮길 때 쓴다. */
  meaning: string;
  branch: EarthlyBranch;
  relation: BranchRelation;
};

export type TodayFortune = {
  date: string;
  weekday: string;
  dayGanji: { korean: string; hanja: string };
  dayMaster: { korean: string; element: FiveElement };
  /** 오늘 천간·지지가 일간에게 오는 십신. 이 화면 해석의 뼈대다. */
  incoming: {
    stemTenGod: string;
    stemAxis: TenGodAxis;
    stemRole: "용신" | "기신" | "중립";
    branchTenGod: string;
    branchAxis: TenGodAxis;
    branchRole: "용신" | "기신" | "중립";
  };
  hits: PalaceHit[];
  voidDay: boolean;
  summary: string;
  overall: FortuneScore;
  domains: FortuneScore[];
  cautions: string[];
  support: { element: FiveElement; colors: string; direction: string; hours: string };
  strength: { score: number; band: "신강" | "신약" | "중간" };
  timeUnknown: boolean;
  profileId: string;
};

const ROLE_SIGN = { 용신: 1, 기신: -1, 중립: 0 } as const;
const RELATION_VALUE: Record<BranchRelation, number> = { 합: 1, 충: -1.2, 형: -0.8 };
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 일간을 이기는 오행 — 관성의 오행. CONTROLS 의 역방향이다. */
const CONTROLLER: Record<FiveElement, FiveElement> = { 목: "금", 토: "목", 수: "토", 화: "수", 금: "화" };

/** 오늘의 KST 날짜. 서버가 UTC 로 돌아도 사용자의 '오늘'과 어긋나면 안 된다. */
export function seoulToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isValidFortuneDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

/**
 * 일진.
 *
 * 정오로 계산한다 — 자시(23시) 경계는 하루를 여는 시각이 아니라 시주의 문제이고,
 * 사용자가 말하는 '오늘'은 달력 하루다. 경도 보정도 하지 않는다: 일주는 하루 종일
 * 같으므로 분 단위 보정이 결과를 바꾸지 않는다.
 */
function dayPillarOf(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return calculateFourPillars({ year, month, day, hour: 12, minute: 0, dayBoundary: DEFAULT_PROFILE.dayBoundary });
}

/** 용신 축이 가리키는 오행. 색·방향은 여기서 나온다. */
function elementForAxis(axis: TenGodAxis, dayElement: FiveElement): FiveElement {
  if (axis === "비겁") return dayElement;
  if (axis === "인성") return PRODUCER[dayElement];
  if (axis === "식상") return PRODUCES[dayElement];
  if (axis === "재성") return CONTROLS[dayElement];
  return CONTROLLER[dayElement];
}

const SUPPORT_COPY: Record<FiveElement, { colors: string; direction: string; hours: string }> = {
  목: { colors: "초록·청록", direction: "동쪽", hours: "오전 5~9시" },
  화: { colors: "붉은색·자주", direction: "남쪽", hours: "오전 11시~오후 1시" },
  토: { colors: "노랑·베이지", direction: "중앙", hours: "오후 1~3시" },
  금: { colors: "흰색·회색", direction: "서쪽", hours: "오후 5~7시" },
  수: { colors: "검정·남색", direction: "북쪽", hours: "밤 9~11시" },
};

/** 축별 주의 문구. 기신 축이 오늘 활성일 때만 쓴다. */
const HOSTILE_CAUTION: Record<TenGodAxis, string> = {
  식상: "말이 앞서기 쉬운 날이에요. 하고 싶은 말은 한 번 적어 보고 꺼내면 덜 후회합니다.",
  관성: "규칙과 상급자 쪽에서 압력이 오기 쉬워요. 오늘은 새 책임을 덥석 받지 않는 편이 낫습니다.",
  재성: "지출과 투자 판단이 흔들리기 쉬운 날이에요. 큰 결제는 하루 미뤄 두세요.",
  인성: "생각만 길어지고 손이 안 움직이기 쉬워요. 작은 것부터 하나 끝내 두면 하루가 풀립니다.",
  비겁: "돈과 사람이 얽히기 쉬운 날이에요. 보증·대여·동업 이야기는 오늘 결론 내지 마세요.",
};

const PALACE_MEANING = {
  년지: "뿌리와 집안",
  월지: "일과 사회적 자리",
  일지: "나 자신과 가장 가까운 관계",
  시지: "앞으로 만들 삶",
} as const;

const RELATION_CAUTION: Record<BranchRelation, (hit: PalaceHit) => string> = {
  충: (hit) => `오늘 지지가 ${hit.palace}(${hit.branch})와 충입니다. ${hit.meaning} 쪽이 흔들리기 쉬우니, 오늘 결정한 것은 내일 한 번 더 확인하세요.`,
  형: (hit) => `오늘 지지가 ${hit.palace}(${hit.branch})와 형입니다. 서류·계약·숫자에서 잔실수가 나기 쉬운 날이에요.`,
  합: (hit) => `오늘 지지가 ${hit.palace}(${hit.branch})와 합입니다. 부탁을 거절하기 어려운 날이니 감당할 수 있는 선만 답하세요.`,
};

const BAND_COPY: Record<FortuneDomain, Record<FortuneBand, { headline: string; detail: string }>> = {
  총운: {
    "아주 좋음": { headline: "흐름이 나를 밀어 주는 날", detail: "오늘 들어오는 기운이 명식에서 부족했던 자리를 채웁니다. 미뤄 둔 연락이나 제안을 꺼내기에 나쁘지 않은 날이에요." },
    좋음: { headline: "무리하지 않으면 순한 날", detail: "크게 튀는 일은 없지만 손에 잡은 것은 진도가 나갑니다. 새로 벌이기보다 하던 것을 마무리하는 쪽이 이득이에요." },
    무난: { headline: "평범하게 흘러가는 날", detail: "특별히 돕는 기운도, 막는 기운도 두드러지지 않습니다. 컨디션과 일정이 오늘의 결과를 더 크게 좌우해요." },
    조심: { headline: "속도를 늦추면 지나갈 날", detail: "오늘 들어오는 기운이 명식에서 이미 과한 쪽을 더 밀어붙입니다. 새로 시작하기보다 정리하고 지키는 쪽이 낫습니다." },
  },
  애정: {
    "아주 좋음": { headline: "마음이 잘 전해지는 날", detail: "표현이 부드럽게 나가고, 상대의 반응도 예상보다 따뜻하게 옵니다. 미뤄 둔 말이 있다면 오늘이 낫습니다." },
    좋음: { headline: "먼저 다가가면 되는 날", detail: "가만히 있으면 그대로지만, 한 걸음 먼저 움직이면 그만큼 돌아옵니다." },
    무난: { headline: "평소와 비슷한 날", detail: "관계에 큰 변수는 없습니다. 기대를 키우기보다 하던 대로 하는 편이 편안해요." },
    조심: { headline: "말수를 줄이면 좋은 날", detail: "사소한 말투에 감정이 얹히기 쉽습니다. 오늘 나온 서운함은 오늘 결론 내지 않는 게 낫습니다." },
  },
  재물: {
    "아주 좋음": { headline: "들어오는 쪽이 열리는 날", detail: "재성이 좋게 움직입니다. 미뤄 둔 정산·청구·협상을 꺼내기에 무리가 없는 날이에요." },
    좋음: { headline: "새는 곳만 막으면 되는 날", detail: "큰 수익보다 관리에서 이득이 납니다. 고정지출을 한 번 훑어보기 좋아요." },
    무난: { headline: "평이한 날", detail: "재물 쪽에 뚜렷한 변수는 없습니다. 계획한 지출 범위 안에서 움직이면 됩니다." },
    조심: { headline: "지갑을 닫는 편이 나은 날", detail: "충동적인 결제와 급한 투자 판단이 겹치기 쉽습니다. 오늘 산 것은 내일 후회하기 쉬워요." },
  },
  성취: {
    "아주 좋음": { headline: "인정받기 좋은 날", detail: "해 둔 일이 눈에 띄기 쉽습니다. 보고·발표·제출처럼 남에게 보이는 일을 오늘로 당겨도 좋아요." },
    좋음: { headline: "한 칸 나아가는 날", detail: "속도는 빠르지 않아도 방향은 맞습니다. 오늘 쌓은 것은 남습니다." },
    무난: { headline: "평소 속도의 날", detail: "특별한 도움도 방해도 없습니다. 일정대로 처리하면 되는 날이에요." },
    조심: { headline: "확인이 필요한 날", detail: "일이 몰리거나 기준이 갑자기 바뀌기 쉽습니다. 오늘은 새로 벌이는 것보다 점검이 이득이에요." },
  },
};

function bandOf(score: number): FortuneBand {
  if (score >= 72) return "아주 좋음";
  if (score >= 58) return "좋음";
  if (score >= 44) return "무난";
  return "조심";
}

function starsOf(score: number) {
  if (score >= 80) return 5;
  if (score >= 65) return 4;
  if (score >= 50) return 3;
  if (score >= 35) return 2;
  return 1;
}

function clamp(value: number) {
  return Math.max(5, Math.min(95, Math.round(value)));
}

export function todayFortune(birth: BirthInput, date: string): TodayFortune {
  if (!isValidFortuneDate(date)) throw new Error("유효하지 않은 날짜입니다.");
  if (!resolveSolarBirthDate(birth)) throw new Error("유효하지 않은 생년월일입니다.");

  const natal = natalChart(birth);
  const timeUnknown = birth.timeUnknown || !birth.time;
  const strength = natalStrength(natal, timeUnknown);

  // 대운은 10년 단위라 오늘 하루를 좌우하진 않지만, 용신·기신 판정에는 들어간다.
  // 이야기 탭·내 사주와 같은 판정을 써야 세 화면이 같은 사람을 말한다.
  const luck = natal.luckPillars;
  const solar = resolveSolarBirthDate(birth)!;
  const [todayYear, todayMonth] = date.split("-").map(Number);
  const ageNow = todayYear + (todayMonth - 1) / 12 - (solar.year + (solar.month - 1) / 12);
  const preciseStart = luck ? luck.startYears + luck.startMonths / 12 + luck.startDays / 365 : 0;
  const luckIndex = luck && ageNow >= preciseStart
    ? Math.min(luck.pillars.length - 1, Math.floor((ageNow - preciseStart) / 10))
    : -1;
  const activeLuck = luckIndex >= 0 ? luck!.pillars[luckIndex].pillar : null;

  const weights = weighAxes(natal, strength.score, timeUnknown, activeLuck);
  const role = (axis: TenGodAxis) => axisRole(weights, axis);

  const flow = dayPillarOf(date);
  const dayStem = natal.day.heavenlyStem;
  const stemTenGod = getTenGod(dayStem, flow.day.heavenlyStem);
  const branchTenGod = getBranchTenGod(dayStem, flow.day.earthlyBranch);
  const stemAxis = axisFromTenGod(stemTenGod);
  const branchAxis = axisFromTenGod(branchTenGod);
  const positions: Array<{ axis: TenGodAxis; weight: number }> = [
    { axis: stemAxis, weight: 1.6 },
    { axis: branchAxis, weight: 1 },
  ];

  // 오늘 지지가 원국의 각 궁과 맺는 관계. 시주는 시간 미상이면 세지 않는다.
  const palaces: Array<{ palace: PalaceHit["palace"]; branch: EarthlyBranch }> = [
    { palace: "년지", branch: natal.year.earthlyBranch },
    { palace: "월지", branch: natal.month.earthlyBranch },
    { palace: "일지", branch: natal.day.earthlyBranch },
    ...(timeUnknown ? [] : [{ palace: "시지" as const, branch: natal.hour.earthlyBranch }]),
  ];
  const hits: PalaceHit[] = palaces
    .map(({ palace, branch }): PalaceHit | null => {
      const relation = branchRelation(flow.day.earthlyBranch, branch);
      return relation ? { palace, meaning: PALACE_MEANING[palace], branch, relation } : null;
    })
    .filter((hit): hit is PalaceHit => hit !== null);

  const hitOf = (palace: PalaceHit["palace"]) => hits.find((hit) => hit.palace === palace);
  const relationOf = (palace: PalaceHit["palace"]) => {
    const hit = hitOf(palace);
    return hit ? RELATION_VALUE[hit.relation] : 0;
  };

  const voidDay = natal.voidBranches.includes(flow.day.earthlyBranch);

  /** 오늘 들어온 축 중 focus 에 해당하는 것의 세기 × 용신/기신 부호. */
  const focusFlow = (focus: TenGodAxis[]) =>
    focus.reduce((sum, axis) => {
      const presence = positions.filter((position) => position.axis === axis).reduce((inner, position) => inner + position.weight, 0);
      return sum + presence * ROLE_SIGN[role(axis)];
    }, 0);
  /** 오늘과 무관하게, 그 축이 이 사람에게 원래 어느 쪽인가. */
  const structural = (focus: TenGodAxis[]) =>
    focus.reduce((sum, axis) => sum + ROLE_SIGN[role(axis)], 0) / focus.length;

  // 애정의 축은 관습을 따른다 — 남성은 재성(배우자), 여성은 관성(배우자).
  // 성별 미입력이면 한쪽으로 정하지 않고 둘 다 본다.
  const loveAxes: TenGodAxis[] = birth.gender === "남성" ? ["재성"] : birth.gender === "여성" ? ["관성"] : ["재성", "관성"];

  const overallRaw = 50
    + 11 * focusFlow(["식상", "관성", "재성", "인성", "비겁"])
    + 4 * structural([stemAxis, branchAxis])
    + 9 * (0.9 * relationOf("일지") + 0.7 * relationOf("월지") + 0.4 * relationOf("년지") + 0.4 * relationOf("시지"))
    - (voidDay ? 5 : 0);
  const loveRaw = 50
    + 11 * focusFlow(loveAxes)
    + 5 * focusFlow(["식상"])
    + 4 * structural(loveAxes)
    + 9 * (1.4 * relationOf("일지") + 0.4 * relationOf("월지"));
  const moneyRaw = 50
    + 11 * focusFlow(["재성"])
    + 5 * focusFlow(["식상"])
    + 4 * structural(["재성"])
    + 9 * (0.6 * relationOf("월지") + 0.5 * relationOf("일지") + 0.4 * relationOf("시지"))
    - (voidDay ? 4 : 0);
  const workRaw = 50
    + 11 * focusFlow(["관성"])
    + 5 * focusFlow(["식상"])
    + 4 * structural(["관성"])
    + 9 * (1.2 * relationOf("월지") + 0.4 * relationOf("년지"));

  const score = (domain: FortuneDomain, raw: number, reason: string): FortuneScore => {
    const value = clamp(raw);
    const band = bandOf(value);
    const copy = BAND_COPY[domain][band];
    return { domain, score: value, stars: starsOf(value), band, headline: copy.headline, detail: `${copy.detail} ${reason}` };
  };

  const strongestHit = [...hits].sort((a, b) => RELATION_VALUE[a.relation] - RELATION_VALUE[b.relation])[0];
  const axisReason = `오늘 천간은 ${stemTenGod}(${stemAxis}), 지지는 ${branchTenGod}(${branchAxis})으로 옵니다.`;
  const hitReason = strongestHit
    ? `오늘 지지 ${flow.day.earthlyBranch}이(가) ${strongestHit.palace} ${strongestHit.branch}과(와) ${strongestHit.relation}을 이룹니다.`
    : "원국의 어느 궁과도 충·합·형을 이루지 않는 날입니다.";

  const overall = score("총운", overallRaw, `${axisReason} ${hitReason}`);
  const domains = [
    score("애정", loveRaw, hitOf("일지")
      ? `배우자 자리인 일지가 오늘 지지와 ${hitOf("일지")!.relation}입니다.`
      : `애정은 ${loveAxes.join("·")} 축으로 봅니다.`),
    score("재물", moneyRaw, `재성은 지금 ${role("재성")} 자리에 있습니다.`),
    score("성취", workRaw, hitOf("월지")
      ? `사회 자리인 월지가 오늘 지지와 ${hitOf("월지")!.relation}입니다.`
      : `관성은 지금 ${role("관성")} 자리에 있습니다.`),
  ];

  // ── 오늘의 주의사항 ──────────────────────────────────────────────────
  // 마찰이 강한 것부터 최대 3개. 근거 없는 경고는 만들지 않는다.
  const cautions: string[] = [];
  for (const hit of [...hits].sort((a, b) => RELATION_VALUE[a.relation] - RELATION_VALUE[b.relation])) {
    if (cautions.length >= 3) break;
    if (hit.relation === "합" && cautions.length >= 2) continue;
    cautions.push(RELATION_CAUTION[hit.relation](hit));
  }
  for (const position of positions) {
    if (cautions.length >= 3) break;
    if (role(position.axis) !== "기신") continue;
    const line = HOSTILE_CAUTION[position.axis];
    if (!cautions.includes(line)) cautions.push(line);
  }
  if (voidDay && cautions.length < 3) {
    cautions.push("오늘 지지가 공망에 듭니다. 시작한 일이 한 번 더 손이 가기 쉬우니, 오늘은 결정보다 준비가 낫습니다.");
  }
  if (cautions.length === 0) {
    cautions.push("특별히 부딪히는 기운은 없습니다. 무리한 확장만 피하면 무난하게 지나갈 날이에요.");
  }

  const supportElement = elementForAxis(weights.usefulAxes[0], natal.dayElement.stem);
  const [year, month, day] = date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];

  return {
    date,
    weekday,
    dayGanji: { korean: flow.dayString, hanja: flow.toHanjaObject().day.hanja },
    dayMaster: { korean: dayStem, element: natal.dayElement.stem },
    incoming: {
      stemTenGod, stemAxis, stemRole: role(stemAxis),
      branchTenGod, branchAxis, branchRole: role(branchAxis),
    },
    hits,
    voidDay,
    summary: `${flow.dayString}일. ${axisReason}`,
    overall,
    domains,
    cautions: cautions.slice(0, 3),
    support: { element: supportElement, ...SUPPORT_COPY[supportElement] },
    strength,
    timeUnknown,
    profileId: DEFAULT_PROFILE.id,
  };
}
