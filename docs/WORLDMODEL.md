# 만약사주 — 뉴로심볼릭 월드모델 도입 계획 (v3)

작성일: 2026-08-16 · 대상: `apps/past-saju` (ifsaju.com)
관련: [ROADMAP.md](./ROADMAP.md) — 본 문서는 **M2(서사 품질)** 의 구현 설계입니다.

---

## 0. 왜 도입하는가

**현재 서비스는 사용자가 쓴 이야기에 대응하지 못합니다.**

사용자는 갈림길을 최대 1,400자(`story` 600 + `outcome` 400 + `alternative` 400)로 서술합니다.
엔진은 이 텍스트를 **금지어 검사(`classifySafety`, `reading-engine.ts:547`)에만 쓰고 버립니다.**
서사에 반영되는 사용자 입력은 실질적으로 `event.category`(8지 선다)와 `event.date`(연·월)뿐입니다.

결과:

| | A씨 | B씨 |
| --- | --- | --- |
| 입력 | "10년 다닌 회사에서 팀장 승진 제안을 받았지만 거절하고 남았다" | "3개월차 스타트업에서 대기업 오퍼를 거절했다" |
| 카테고리 | 이직 | 이직 |
| **엔진이 구분하는 것** | **없음** | **없음** |

두 사람의 서사는 생년월일이 다른 만큼만 다릅니다. 같은 축이 뽑히면 **문장은 글자 단위로 동일**합니다.
사용자가 1,400자를 쓴 대가로 얻는 것은 카테고리 문자열 치환 한 번입니다.

이것이 ROADMAP이 M2에서 "재방문·공유가 성립하지 않는 근본 원인"으로 지목한 문제이며,
**뉴로심볼릭 월드모델은 이 문제의 정확한 해법입니다. 도입합니다.**

### 0.1 원안(v1)과의 관계 — 방향은 옳고, 출발점 진단만 반대였다

v1은 "LLM이 명식·서사를 만들고 있으니 결정론적 코어로 걷어내라"를 전제했습니다.
코드에 LLM 호출은 **0건**이므로 이 전제는 반대입니다. 하지만 **목표 상태는 동일합니다.**

```
v1이 가정한 출발점:  [LLM이 전부 담당]     → 심볼릭 코어를 만들어 LLM을 밀어낸다
실제 출발점:        [심볼릭이 전부 담당]   → 경계 두 곳에 LLM을 얹는다
공통 목표:          [심볼릭 코어 + 뉴럴 경계]
```

**실제 출발점이 더 유리합니다.** v1이 Phase 1~3에 걸쳐 만들려던 것(명식 엔진, 전이 규칙, 세 갈래 도출)이 이미 존재하고 30개 프로필 회귀 픽스처를 통과하고 있습니다. 남은 일은 **뉴럴 층 두 개를 추가하는 것**뿐이고, 이는 v1이 예상한 작업량보다 훨씬 작습니다.

즉 v1의 결론은 "LLM을 줄여라"가 아니라 **"LLM을 정확히 두 곳에만, 제약을 걸어 넣어라"** 로 읽어야 합니다.

### 0.2 뉴럴/심볼릭 경계 — 이 계약이 설계의 전부

| 층 | 담당 | LLM | 근거 |
| --- | --- | :---: | --- |
| **L2 이해** | 자연어 갈림길 → 유한 심볼 + 원문 근거 | **✅ 폴백으로만** | 무한 자연어는 규칙으로 못 덮음 |
| L1 명식 | 4주·대운·세운·오행·십신 | ❌ 절대 금지 | 정답이 존재. `manseryeok` + 골든 테스트 |
| L1 판정 | 신강·신약, 용신·기신 | ❌ 절대 금지 | 유파 규칙. 프로파일로 고정 |
| L3 전이 | 충·합·형 판정, 36개월 전환점 | ❌ 절대 금지 | 결정론 규칙 테이블 |
| L4 분기 | 세 갈래 축 집합 | ❌ 절대 금지 | "사주가 고른" 카피의 근거 |
| 안전 | 고위험 사건 차단 | ❌ 절대 금지 | 실패 시 사람이 다뤄야 함 |
| 봉인 | 커밋먼트 해시 | ❌ 절대 금지 | 암호학적 보장 |
| **L5 표현** | 확정된 Fact → 문장 | **✅ 주 경로** | 서사 품질 = 제품 가치 |

**LLM은 L2와 L5에만 들어갑니다.** L2는 들어오는 말을 심볼로 접고, L5는 확정된 심볼을 말로 폅니다.
그 사이의 모든 판단은 코드가 합니다. 이것이 "뉴로심볼릭"의 실질이고, 아래 전부는 이 계약의 구현입니다.

---

## 1. 도입 후 무엇이 달라지는가

L2가 붙으면 사용자 입력이 **두 경로**로 서사에 들어갑니다.

### 경로 1 — 심볼 (엔진 판단을 바꾼다)

`ForkKey`가 **축 편향(`branchBias`)** 을 만들어 `rankedAxes()`(`:209`)에 들어갑니다.
현재 이 함수는 원국과 대운만 봅니다. 여기에 갈림길 편향이 더해지면 **같은 사람이라도 갈림길이 다르면 세 갈래 자체가 달라집니다.**

```
CAREER / LEAVE_STAY / 실제=STAY      → 가지 않은 길 = 떠남 → 식상·비겁 증폭, 관성 억제
CAREER / LEAVE_STAY / 실제=LEAVE     → 가지 않은 길 = 잔류 → 관성·인성 증폭, 식상 억제
RELATION / JOIN_SEPARATE / 실제=SEPARATE → 전혀 다른 축 집합
```

이 한 줄의 변경(`rankedAxes`에 인자 하나 추가)이 **가장 레버리지가 큽니다.** LLM 없이 패턴 매칭만으로도 즉시 효과가 납니다.

### 경로 2 — 근거 인용 (문장을 내 이야기로 만든다)

L2가 원문에서 **발췌한 조각**(`ForkEvidence`)을 L5에 넘깁니다.

```
현재:   "이직의 갈림길에서 당장 떠나기보다 조건과 책임의 경계를 분명히 다시 정한다."
도입 후: "10년을 쌓은 자리에서 승진 제안을 내려놓는 대신 조건을 다시 세웠다면 …"
              ↑ 원문 발췌        ↑ 원문 발췌
```

**발췌는 원문에 실재하는 문자열만 허용합니다**(§3.3). LLM이 지어낸 세부는 코드가 기각합니다.

### 정리

| | 지금 | 도입 후 |
| --- | --- | --- |
| 사용자 서술 반영 | 금지어 검사만 | 축 선택 + 문장 인용 |
| 같은 카테고리·같은 축 | 문장 100% 동일 | 갈림길별로 축·문장 상이 |
| 두 번째 이야기(M3) | 성립 불가 | 같은 원국 + 다른 갈림길 = 다른 결과 |
| 사실 정확성 | 코드가 보장 | **코드가 계속 보장** (경계 계약) |

---

## 2. 현황 (Phase 0 감사 결과 — 코드 확인분)

### 2.1 스택

| 항목 | 값 | 근거 |
| --- | --- | --- |
| 프레임워크 | Next.js 16.2.12 (App Router, webpack), React 19.2.4, Node ≥22 | `package.json` |
| 배포 | Firebase App Hosting (project `pastsaju`, asia-east1) | `apphosting.yaml` |
| 저장소 | Firestore (Admin SDK, 서버 전용) + 개발용 인메모리 폴백 | `src/lib/reading-store.ts` |
| TTL | 7일 (`SESSION_TTL_MS` + Firestore `expiresAt` + 메모리 prune) | `reading-store.ts:6` |
| LLM 호출 | **0건** — SDK 의존성 없음 | `package.json` |
| 테스트 | 러너 없음. `tsc` 후 node 실행하는 픽스처 2종 | `scripts/*-fixtures.ts` |
| 인증·속도제한 | **없음** (§6-A) | `src/app/api/**` |

### 2.2 명식 계산 — 이미 견고함, 재구현 금지

`manseryeok@2.0.0`(MIT, KASI 기반)이 담당합니다. **v1이 "L1의 실질적 난이도 전부"로 지목한 항목이 전부 라이브러리에 있습니다.**

| v1이 직접 구현하라고 한 것 | 실제 |
| --- | --- |
| 한국 표준시 이력(1954–61 동경 127.5°) | `time/korea-timezone` — IANA tz database(Asia/Seoul + ROK rules) |
| 서머타임 구간 | 동일 테이블. `applyHistoricalDst: true` (`reading-engine.ts:186`) |
| 진태양시 + 균시차 | `resolveInstant()` — 절대순간(연·월주)과 지방 진태양시(일·시주) 분리 반환 |
| 절입 시각(분 단위) | `solarTermInstantMs()` — 1800~2300 정밀 절입표, 밖은 Meeus 근사 |
| 자시 처리 | `dayBoundary: 'midnight'\|'jasi'\|'splitJasi'`. 현재 `'jasi'` 하드코딩 (`:182`) |
| 대운 방향·대운수 | `getLuckPillars()` — 양남음녀 순행, 절입 일수 ÷ 3 |

→ **v1의 "서머타임·표준시 테이블을 1차 자료로 확인받으라"는 지시는 대상이 없습니다.** 남는 일은 라이브러리 검증(Track B)이며, 이는 뉴럴 도입을 막지 않습니다.

### 2.3 사용자 입력의 실제 소비처

| 필드 | 사용처 |
| --- | --- |
| `event.category` | `choiceText()`(`:349`), `resultFor()` 문자열 치환 |
| `event.date` | `pillarForMonth()`(`:249`) — 36개월 전환점 기준 시점 |
| `context.freedom` / `fear` | `realityNote` 한 문장 분기 |
| `context.readiness` | **미사용** |
| **`story` / `outcome` / `alternative`** | **`classifySafety()` 뿐. 서사 미반영** |

### 2.4 판정표

| 항목 | 현재 | 결정론? | 층 | 작업 |
| --- | --- | :---: | :---: | --- |
| 4주 산출 | `manseryeok` 위임 | ✅ | L1 | 어댑터화 + 골든 (Track B) |
| 대운/세운 | `luckPillars` + 월운 근사 | ✅ | L1 | 세운 결함 수정 (§6-5) |
| 신강·용신 | 자체 점수식, 45/55 하드코딩 | ✅ | L1 | 프로파일 외부화 |
| **갈림길 이해** | **없음** | — | **L2** | **★ 신규 — 최우선** |
| 3년 전개 | `buildTurningPoints()` | ✅ | L3 | 규칙 외부화 + 이중 궤적 |
| 세 갈래 | `rankedAxes()` 상위 3축 | ✅(집합) | L4 | **fork bias 인자 추가** |
| **문장 생성** | **5축 고정 템플릿** | ✅ | **L5** | **★ 신규 — LLM 렌더러** |
| 충실성 검사 | `validateNarrative()` | ✅ | L5 | 확장 (원형 이미 존재) |

---

## 3. 설계

### 3.1 L2 — 갈림길 이해 ★

**출력 두 갈래.** 심볼은 엔진이, 근거는 렌더러가 씁니다.

```ts
// src/lib/fork/types.ts
export type ForkFrame = {
  key: ForkKey;           // 엔진 소비 — 유한 심볼
  evidence: ForkEvidence; // 렌더러 소비 — 원문 발췌
};

export type ForkKey = {
  domain: DomainId;              // CAREER | VENTURE | RELATION | STUDY | MOVE | WEALTH | HEALTH
  polarityAxis: PolarityId;      // LEAVE_STAY | EXPAND_CONTRACT | JOIN_SEPARATE
  actualChoice: PolarityValue;   // 실제로 택한 극
  counterfactual: PolarityValue; // 가지 않은 극
  intensity: 1 | 2 | 3;          // context 3슬라이더에서 결정론적으로 산출
  timepoint: { year: number; month: number; luckIndex: number };
  confidence: number;            // 0~1
};

export type ForkEvidence = {
  subject: string | null;    // "10년 다닌 회사"
  stakes: string[];          // 걸려 있던 것
  constraint: string | null; // 제약
  quotes: string[];          // 최대 3개
};
```

**`evidence`의 모든 문자열은 원문 부분문자열이어야 합니다.** 추상화·요약·재작성 금지. 검증은 코드가 합니다(§3.3).
`intensity`는 이미 수집 중인 `context` 3슬라이더에서 산출합니다 — **미사용이던 `readiness`가 여기서 쓰입니다**(§6-9 해소).

**온톨로지** (`fork/ontology.ts`) — YAML이 아니라 TypeScript 모듈입니다. 이 프로젝트에 YAML 파서 의존성이 없고, enum이 `reading-types.ts`의 타입과 컴파일 타임에 맞물려야 하기 때문입니다(오타 = 빌드 실패). 사람이 편집하는 데이터 테이블이라는 성격은 그대로입니다.

```ts
export const DOMAINS = {
  CAREER:   { label: "직업",      axis: ["관성"] },
  VENTURE:  { label: "창업·독립",  axis: ["식상", "재성"] },
  RELATION: { label: "관계",      axis: "@일지" }, // 배우자궁 파생 — §7-4 결정 완료
  STUDY:    { label: "학업",      axis: ["인성"] },
  MOVE:     { label: "거주·이주",  branchAxis: ["역마"] },
  WEALTH:   { label: "재물",      axis: ["재성"] },
  HEALTH:   { label: "건강",      axis: [] },
} as const;

// 갈림길 → 축 편향. L4가 소비하는 결정론 테이블.
export const BIAS: Record<string, Partial<Record<TenGodAxis, number>>> = {
  "CAREER:LEAVE":   { 식상: +1.2, 비겁: +0.8, 관성: -0.6 },
  "CAREER:STAY":    { 관성: +1.2, 인성: +0.8, 식상: -0.6 },
  // RELATION은 고정 축이 없다. 일지(배우자궁)의 십신에서 사람마다 도출한다 — §3.1-a
  // …
};

// 1단계 결정론 패턴. 히트하면 LLM 호출 없이 종료.
export const PATTERNS = [
  { match: ["퇴사", "그만두", "이직", "옮기"],  domain: "CAREER",   axis: "LEAVE_STAY",    actual: "LEAVE" },
  { match: ["남았", "잔류", "버티", "계속 다"], domain: "CAREER",   axis: "LEAVE_STAY",    actual: "STAY" },
  { match: ["헤어지", "이별", "정리했"],       domain: "RELATION", axis: "JOIN_SEPARATE", actual: "SEPARATE" },
  // …
] as const;
```

#### 3.1-a. 관계 도메인의 축 — 배우자궁(일지) 파생 · 결정 완료

RELATION은 `BIAS`에 고정 항목을 두지 않습니다. **일지(日支, 배우자궁)의 십신에서 사람마다 도출합니다.**

```ts
// 관계 축은 표에서 읽지 않고 명식에서 계산한다
const relationAxis = axisFromTenGod(chart.tenGods.day.branch);

function relationBias(fork: ForkKey, chart: FourPillarsDetail): Partial<Record<TenGodAxis, number>> {
  const axis = axisFromTenGod(chart.tenGods.day.branch);
  const sign = fork.counterfactual === "JOIN" ? +1 : -1;   // 결합 쪽이 반사실이면 증폭
  return { [axis]: sign * 1.2 * fork.intensity / 2 };
}
```

**전통 규칙(남명 재성 / 여명 관성)은 채택하지 않습니다.** 근거:

1. **성별 입력에 의존하지 않습니다.** 폼의 `gender`에는 `"응답 안 함"`이 있고, 이 사용자들은 `manseryeok.getLuckPillars()`가 성별을 요구하는 탓에 **이미 대운을 받지 못합니다**(`chart.luckPillars`가 `undefined`, 근거란에 "성별 미입력으로 대운은 낮춰 반영", `:344`). 전통 규칙을 쓰면 이들은 대운에 이어 관계 갈림길까지 열화됩니다.
2. **같은 사연이 성별로 갈리지 않습니다.** 전통 규칙에서는 동일한 이별 서술이 남성에게 재성("실리를 고르는 길"), 여성에게 관성("구조를 다시 세우는 길")으로 나뉩니다. 제품 톤상 의도된 결과가 아닙니다.
3. **코드가 이미 이 관점을 씁니다.** `invariantFromChart()`(`:290`)가 일지를 "나의 리듬과 가까운 관계"로 다루고 있습니다. 관계 축을 일지에서 뽑으면 두 곳의 해석이 일치합니다.
4. **유지할 테이블이 없습니다.** 명식에서 파생되므로 사람마다 다른 축이 나오고, 하드코딩 항목이 생기지 않습니다.

기록: 2026-08-16 결정. 변경하려면 §7-4를 다시 엽니다.

**2단계 분류** (`fork/classify.ts`)

1. **결정론 패턴 매칭.** `event.category`가 도메인의 사전 힌트를 줍니다(사용자가 이미 고른 값). 따라서 남는 문제는 대개 **극성 판정**뿐이고, 이 조건은 v1 설계보다 유리합니다. 히트 시 LLM 호출 없이 종료 → **비용 0.**
2. **LLM 폴백.** 미히트 시에만. 구조화 출력으로 enum 밖 생성을 차단합니다.

```ts
const res = await client.messages.parse({
  model: "claude-opus-5",
  max_tokens: 2048,
  output_config: { format: zodOutputFormat(ForkFrameSchema) }, // enum + 발췌 스키마 강제
  system: [{ type: "text", text: ONTOLOGY_PROMPT, cache_control: { type: "ephemeral" } }],
  messages: [{ role: "user", content: userStoryBlock }],
});
```

**UNKNOWN 처리** — `confidence < 0.7`이거나 파싱 실패 시:

- 사용자에게는 **현행 축 기반 서사를 그대로** 제공. 지금 동작이 곧 폴백이므로 **회귀 위험이 0입니다.** 이것이 이 도입 계획의 안전성 핵심입니다.
- 원문 + 사유를 `queue/unknowns`에 적재 (**세션과 동일한 7일 TTL** — 원문은 개인 서술이므로 예외를 만들지 않음).
- 주 1회 사람이 검토 → `PATTERNS`에 추가. 온톨로지 변경은 항상 사람 승인. **이것이 월드모델의 진화 루프입니다.**

**지표:** `unknownRate`(주간 미분류율) → `internalMetrics/phase-zero`에 카운터 추가. **목표 < 20%.**

### 3.2 L4 — fork bias 연결 (변경 최소, 효과 최대)

```diff
- function rankedAxes(chart, strengthScore, timeUnknown, activeLuck)
+ function rankedAxes(chart, strengthScore, timeUnknown, activeLuck, forkBias)
```

`BIAS["<domain>:<counterfactual>"]`를 축 점수에 가산합니다. 가중치는 기존 스케일(원국 1.0 / 월주 1.45 / 대운 1.8)에 맞추되 **대운을 넘지 않게 상한**을 겁니다 — 갈림길이 명식을 이겨서는 안 됩니다(카피의 전제).

세 갈래 **집합은 여전히 결정론**입니다. `randomBytes`(`:557`)는 좌/중/우 **슬롯 배치**에만 관여하며, 봉인 카드 UX상 위치 예측 불가가 목적이므로 유지합니다. 이 구분을 코드 주석과 테스트로 고정합니다 — 현재 어떤 테스트도 슬롯 배치를 검증하지 않아 다음 사람이 버그로 오인할 수 있습니다.

### 3.3 L5 — LLM 렌더링

**입력 계약.** 원본 명식을 주지 않습니다. 확정된 Fact만 전달합니다.

```json
{
  "narrative_scope": "counterfactual_3y",
  "facts": [
    { "id": "F1", "monthOffset": 4,  "domain": "관계",      "valence": "마찰",
      "basis": "일지-월운지 沖", "cost": "기존 관계 재편" },
    { "id": "F2", "monthOffset": 11, "domain": "직업·명예", "valence": "기회",
      "basis": "정관 활성",     "cost": "자율성 축소" }
  ],
  "evidence": { "subject": "10년 다닌 회사", "quotes": ["팀장 승진 제안을 받았지만"] },
  "invariantTheme": "…",
  "constraints": [
    "facts와 evidence에 없는 사건·인물·수치·지명·금액을 만들지 말 것",
    "evidence의 문자열은 그대로 인용할 것. 바꿔 쓰지 말 것",
    "각 문단은 참조한 fact id를 factIds로 반환할 것",
    "단정적 예언 금지 ('~하게 된다' → '~가능성이 읽힙니다')",
    "의료·법률·재무 조언 금지"
  ]
}
```

**호출 설정**

| 항목 | 값 | 근거 |
| --- | --- | --- |
| 모델 | `claude-opus-5` | 서사 품질이 제품 가치 자체 |
| thinking | 기본(adaptive) 유지 | Opus 5는 미지정 시 adaptive. **`max_tokens`는 thinking + 본문 합계 상한**이므로 여유 있게 설정 |
| effort | `output_config: { effort: "medium" }`부터 스윕 | 짧은 한국어 서사에 `xhigh`는 과함. low/medium부터 평가 |
| 스트리밍 | `client.messages.stream()` | 현 `setTimeout(240~420ms)` 인위 지연(`stream/route.ts:73`)을 실제 토큰 스트리밍으로 대체. **NDJSON 청크 계약 유지 → 클라이언트 무변경** |
| 캐싱 | 시스템 프롬프트 + 온톨로지 + 톤 지침에 `cache_control` | Opus 5 캐시 최소 512토큰이라 이 규모도 대상 |
| 구조화 출력 | `output_config.format` (문단별 `factIds`) | 충실성 검사의 입력 |

**생성 비용 1/3.** `commitment`은 카드의 짧은 선택지 문구(`choice.text`)에만 걸려 있고 서사 본문을 포함하지 않습니다(`:576`). 따라서 세션 생성 시 3장을 다 만들 필요가 없습니다.
→ `createReadingSession`은 3축의 `NarrativeSpec`까지만(결정론·무료), 렌더링은 `stream/route.ts`에서 **선택된 1장에만.**

**충실성 검사** (`render/fidelity.ts`) — 3중, 앞의 둘은 LLM 없이 결정론:

1. **기존 `validateNarrative()` 재사용**(`:527`). 전환점 개월 수 누락, 주요 영역 누락, 단정 표현(`"반드시 일어"`, `"틀림없이"`, `"병에 걸"` …), 우월 결말을 **이미 위반으로 잡습니다.** 이 함수가 사실상 완성된 fidelity checker입니다.
2. **인용 검증.** `evidence.quotes`의 각 문자열이 정규화된 원문에 부분문자열로 실재하는지. 없으면 기각. **이 검사 하나로 세부 날조가 구조적으로 불가능해집니다.**
3. **fact-id 대조.** 문단이 선언한 `factIds`가 실제 spec에 있는지.

별도 LLM 판정 호출은 3단계로 미룹니다 — 위 셋이 결정론적이고, 비용·지연 대비 추가 이득이 불확실합니다.

**실패 시:** 재생성 최대 1회 → 그래도 실패하면 **현행 템플릿 결과로 폴백.** 사용자는 실패를 보지 않습니다.
**지표:** `hallucinationRate` = 검사 실패율. 임계 초과 시 자동 템플릿 전환.

### 3.4 L3 — 이중 궤적 (후순위)

`buildTurningPoints()`는 이미 결정론적이고 쓸 만합니다. 개선은 둘:

1. `branchRelation()`(`:239`)의 충·합·형 판정과 강도를 `transition/rules.ts`로 외부화 (형 규칙이 불완전 — §6-7).
2. **실제 궤적 / 대안 궤적을 동일한 `step` 함수로 굴립니다.** 서사의 차이는 초기 bias 차이에서만 나와야 합니다. 현재는 3장 모두 "가지 않은 길"이고 실제 궤적 개념이 없습니다.

규칙 원칙(v1 유지): 모든 대안 궤적은 **이득과 대가를 함께** 산출. 이득만 있는 분기 금지. 규칙 충돌은 덮어쓰기가 아니라 `themes` 합집합 + 명시적 우선순위. — 현 `validateNarrative`의 "우월 결말" 검사(`:540`)가 이미 이를 강제하므로 확장만 하면 됩니다.

---

## 4. 디렉터리

v1의 `src/worldmodel/**` 신규 트리는 587줄 단일 모듈을 한 번에 쪼개는 큰 변경이고 ROADMAP M5와 충돌합니다. 기존 `src/lib/` 규약 안에서 층별로 떼어냅니다.

```
src/lib/
  reading-types.ts        # ForkFrame, WorldState 추가
  reading-engine.ts       # 오케스트레이션만 남김
  fork/                   # L2 ★ 신규
    ontology.ts           #   DOMAINS · POLARITIES · BIAS · PATTERNS (사람이 편집)
    classify.ts           #   패턴 → LLM 폴백 → UNKNOWN
    types.ts
  render/                 # L5
    template.ts           #   현 resultFor 이관 (영구 폴백 경로)
    llm.ts                #   Claude 렌더러
    fidelity.ts           #   validateNarrative 확장
  chart/                  # L1 (Track B)
    adapter.ts · strength.ts · profile.ts
  transition/             # L3 (후순위)
    rules.ts · rollout.ts
  queue/unknowns.ts
  llm/client.ts           # SDK 클라이언트 · 킬스위치 · 예산 · 입력 해시 캐시
scripts/
  engine-fixtures.ts      # 확장
  fork-fixtures.ts        # 신규 — 분류 골든 케이스
  chart-golden.ts         # 신규 — 명식 골든 러너
  determinism.ts          # 신규
```

---

## 5. 도입 순서 — 2트랙 병행

이전 초안은 L1 골든 테스트(사람이 만세력 40건 대조)를 전체 게이트로 두었습니다. **이 순서를 폐기합니다.** L1은 이미 라이브러리 위임 + 30 프로필 픽스처 통과 상태이고, 골든 검증은 사람 대기로 길어질 수 있습니다. 뉴럴 도입을 여기에 묶으면 정작 사용자 문제 해결이 무기한 지연됩니다.

L2/L5는 L1 출력을 **바꾸지 않고 소비만** 하므로 병행이 안전합니다.

### Track A — 뉴럴 도입 (코드 작업, 즉시 착수)

| Phase | 내용 | LLM | 게이트 |
| --- | --- | :---: | --- |
| **A0** ◐ | **남용 방지 + 법적 정비 (§6-A). 하드 블로커** | — | **코드 완료 2026-08-16, 외부 설정 남음** — §5.0-a 참조 |
| **A1** ✅ | `fork/ontology.ts` + 패턴 매칭 1단계 + `rankedAxes` bias 인자 | **없음** | **완료 2026-08-16** — §5.1-a 참조 |
| **A2** ◐ | L2 LLM 폴백 + evidence 추출 + `queue/unknowns` | ✅ | **코드 완료 2026-08-16, 실호출 검증 미만** — §5.2-a 참조 |
| **A3** | `render/template.ts` 이관 (동작 무변경 리팩터, §6-4 dead code 통합) | — | 출력 바이트 동일 |
| **A4** | `render/llm.ts` + fidelity 3단 + 토큰 스트리밍 + feature flag A/B | ✅ | 폴백률 < 5% · 킬스위치 ON에서 완전 동작 |

**A1이 LLM 없이 효과를 냅니다.** 패턴 매칭만으로도 "퇴사 / 남았 / 헤어지" 류 다수 케이스가 잡히고, 축 편향이 붙는 순간 세 갈래가 갈림길에 반응하기 시작합니다. **비용 0으로 문제의 절반을 먼저 해결하고, 그 커버리지 부족분을 A2의 LLM이 메웁니다.** 이 순서면 LLM 도입 전에 부분 출시가 가능하고, A2/A4가 지연돼도 제품은 전진합니다.

#### 5.0-a. A0 구현 기록 (2026-08-16)

**추가된 파일**

| 파일 | 역할 |
| --- | --- |
| `src/lib/rate-limit.ts` | IP 해시 기준 1시간 고정 윈도. Firestore 트랜잭션 + 개발용 메모리 폴백 |
| `src/lib/request-guard.ts` | `clientKey()` (위조 내성 XFF 파싱 + 해시) · `readBoundedBody()` (스트림 누적 상한) |
| `src/lib/app-check.ts` | App Check 토큰 서버 검증. `off`/`monitor`/`enforce` 3단 |
| `src/app/privacy/page.tsx` · `src/app/terms/page.tsx` | 법적 고지 라우트 (정적 프리렌더) |
| `scripts/guard-fixtures.ts` | 6개 검증 블록. `pnpm test`에 편입 |

세 API 라우트 모두 **App Check 검증 → 속도 제한 → 본문 상한 → 기존 로직** 순으로 통과합니다.

**설계 결정 3건**

1. **`X-Forwarded-For`는 마지막 항목을 씁니다.** 프록시는 자신이 받은 주소를 뒤에 덧붙이므로, 클라이언트가 위조한 값은 앞에 남습니다. 앞에서 고르면 헤더 한 줄로 속도 제한을 우회할 수 있습니다. 인프라가 다르면 `RATE_LIMIT_XFF_DEPTH`로 조정하며, 값이 틀리면 **모든 요청이 한 키로 묶여 과차단**됩니다 — 조용히 열리지 않고 눈에 띄게 막히는 쪽을 택했습니다.
2. **원본 IP를 저장하지 않습니다.** SHA-256 해시 앞 32자만 카운터 키로 씁니다. 개인정보 최소 수집이면서 속도 제한에는 충분하고, 이 사실을 개인정보처리방침에도 명시했습니다.
3. **저장소 장애 시 통과시킵니다(fail-open).** 속도 제한 카운터가 죽었다고 정상 사용자를 막는 것보다는 낫고, 저장소가 죽으면 세션 저장 자체가 503으로 먼저 막힙니다.

**끝나지 않은 것 — 외부 설정이 필요합니다**

| 항목 | 상태 | 남은 일 |
| --- | --- | --- |
| App Check | 서버 검증만 구현 | 콘솔에서 reCAPTCHA Enterprise 사이트 키 발급 → 클라이언트 `firebase` SDK 연결 → `monitor`로 관찰 → `enforce` |
| `rateLimits` TTL | 코드가 `expiresAt`을 씀 | `gcloud firestore fields ttls update expiresAt --collection-group=rateLimits --enable-ttl` (README 반영) |
| 속도 제한 한도 | 초안 (세션 10회/시) | 국내 이동통신 NAT 비중이 높아 한 IP를 여러 사용자가 공유합니다. 배포 후 429 발생률로 조정 |
| XFF 깊이 | 기본 1 | App Hosting 실트래픽에서 실측 확인 |
| 법적 문안 | 코드 동작 근거 초안 | **법률 검토 필수.** 사업자 정보와 문의처(`support@ifsaju.com`)는 placeholder |

**Anthropic 수탁자 고지는 일부러 넣지 않았습니다.** 아직 외부로 나가는 데이터가 없으므로 사실이 아닌 위탁을 적을 수 없습니다. 대신 방침에 "문장 생성에 외부 인공지능 서비스를 이용하게 되는 경우 표에 먼저 반영한 뒤 적용한다"고 명시했고, **A2 게이트의 첫 항목으로 순서를 고정**했습니다.

**게이트 결과:** 신규 픽스처 6블록 통과 · 기존 픽스처 3종 무회귀 · `tsc --noEmit` 통과 · `eslint` 통과 · `next build` 통과(`/privacy`·`/terms` 정적 생성).

#### 5.2-a. A2 구현 기록 (2026-08-16)

**추가된 파일**

| 파일 | 역할 |
| --- | --- |
| `src/lib/llm/client.ts` | Anthropic 클라이언트 · 킬스위치 · 모델 상수 |
| `src/lib/llm/budget.ts` | 일일 호출 상한(기본 500). Firestore 트랜잭션 |
| `src/lib/fork/classify-llm.ts` | enum 강제 구조화 출력 + 발췌 추출 |
| `src/lib/fork/evidence.ts` | 발췌 근거 검증(부분문자열 포함) |
| `src/lib/fork/resolve.ts` | 패턴 → LLM → UNKNOWN 오케스트레이션 |
| `src/lib/queue/unknowns.ts` | 미분류 적재(7일 TTL) + `unknownRate` 카운터 |
| `src/lib/firebase-client.ts` | App Check 클라이언트 토큰 발급 |
| `scripts/l2-fixtures.ts` | 7개 검증 블록 |

**설계 결정 4건**

1. **엔진은 순수 동기로 남겨 두고, 신경망 호출을 라우트 경계로 뽑았습니다.**
   `createReadingSession`을 async로 바꾸면 L1~L4 결정론 원칙이 흐릿해집니다. 대신 `resolveFork()`를
   라우트에서 `await`하고 **확정된 심볼만** 엔진에 넘깁니다. 기존 픽스처도 그대로 통과합니다
   (`createReadingSession(input)` — fork 인자는 선택).
2. **발췌는 원문 부분문자열이어야 합니다.** 공백·문장부호 차이는 허용하되 단어를 지어내거나 어순을
   바꾸면 떨어집니다. 픽스처가 지명·금액·인물 날조를 전부 막는지 단언합니다.
3. **근거 없는 항목만 버리고 분류는 살립니다.** 발췌는 부가 정보고 심볼(`ForkKey`)이 본체입니다.
   발췌 하나 때문에 분류 전체를 버리면 `unknownRate`만 오릅니다.
4. **예산은 fail-closed, 속도 제한은 fail-open.** 예산을 세지 못하면 쓰지 않습니다(비용이 새므로). 속도 제한
   카운터가 죽으면 통과시킵니다(정상 사용자를 막을 이유가 없음).

**안전 순서** — 라우트는 `App Check → 속도 제한 → 본문 상한 → 입력 검증 → 연령 → classifySafety → resolveFork` 순입니다.
**차단 대상 서술은 외부로 나가지 않습니다.** 개인정보처리방침에도 이 사실을 명시했습니다.

**검증되지 않은 것 — 실호출**

이 환경에 API 키가 없어 **실제 모델 응답을 받아 본 적이 없습니다.** 타입 체크와 가드 로직은
통과했지만, 요청 모양(`output_config.format` + `effort` + 베타 `fallbacks`)이 실제로 받아들여지는지는
첫 배포에서 확인해야 합니다. 실패하면 **`forkReason_llm_error`가 치솟고 `unknownRate`가 100%에 가깝게**
나오므로 지표로 즉시 드러납니다. 서비스는 그 경우에도 패턴 경로로 정상 동작합니다.

첫 배포 후 확인 순서: `forkReason_llm_error` → 400이면 `LLM_SERVER_FALLBACK=false` → 그래도 실패하면 `output_config` 모양.

**게이트 결과:** 신규 픽스처 7블록 · 기존 픽스처 4종 무회귀 · `tsc --noEmit` · `eslint` · `next build` 통과.
`unknownRate` < 20%는 **측정 수단은 갖추었으나 실트래픽이 있어야 판정합니다.**

#### 5.1-a. A1 구현 기록 (2026-08-16)

**추가된 파일**

| 파일 | 역할 |
| --- | --- |
| `src/lib/fork/types.ts` | `ForkKey` · `ForkEvidence` · `ForkFrame` · `ForkResult` · `AxisBias` |
| `src/lib/fork/ontology.ts` | `DOMAINS` · `POLARITY_POLES` · `CATEGORY_HINT` · `BIAS` · `PATTERNS` · `POLE_LABEL` |
| `src/lib/fork/classify.ts` | `classifyFork()` — 패턴 전용, LLM 없음. `normalizeText()` 공개(M1-C 공유용) |
| `src/lib/fork/bias.ts` | `forkBias()` · `relationBias()` · `BIAS_CAP` |
| `src/lib/ten-god-axis.ts` | `AXES` · `axisFromTenGod()` — 순환 참조 없이 fork가 쓰도록 분리 |
| `scripts/fork-fixtures.ts` | 12개 검증 블록. `pnpm test`에 편입 |

**설계 결정 3건**

1. **`outcome` 3점 · `story` 2점 · `alternative` 2점(극 반전).** `alternative`는 가지 않은 쪽을 서술하므로 히트한 극을 뒤집어 집계합니다. "그때 퇴사했다면"은 실제로는 남았다는 뜻입니다.
2. **패턴은 도메인이 아니라 극성을 가릅니다.** 도메인은 `CATEGORY_HINT`가 거의 정해 주므로, 패턴에 종결어까지 넣어("이직" → "이직했") "이직 제안을 받았지만 남았다"가 양극에 동시 히트하지 않게 했습니다.
3. **`rankedAxes`는 순위를 두 벌 계산합니다.** 편향은 **카드 축 선택에만** 들어가고 용신·기신은 편향 없는 점수로 뽑습니다. 용신·기신은 명식 판정이므로 갈림길이 바꾸면 L1/L2 경계가 무너집니다. 픽스처가 이를 단언합니다.

**측정된 한계 — 축 집합 변화율 6/10**

같은 명식에 정반대 갈림길을 넣었을 때 **카드 축 집합이 달라진 비율은 10건 중 6건**입니다. 카드는 5축 중 상위 3축이라, 편향(≤1.8)이 3위와 4위의 점수 격차를 넘지 못하면 집합이 그대로입니다. 편향 상한을 올리면 비율은 오르지만 **갈림길이 대운을 이기게 되어** "사주가 고른 세 개의 길"이라는 전제가 깨지므로 올리지 않았습니다.

나머지 4할에서는 근거란(`basis.eventFlow`)만 갈립니다 — 픽스처가 10/10 차이를 단언합니다. **본문까지 가르는 일은 A4(L5)의 몫입니다.** 서사가 축에서만 나오는 현재 구조의 한계이며, 이것이 A4가 필요한 구체적 근거입니다.

실측 예 (1991-07-15 09:30 서울 · 여성 · 이직 · 2021-09):

```
outcome "결국 퇴사했습니다."  → 식상 / 인성 / 관성   (남는 쪽을 반영)
outcome "결국 남았습니다."    → 비겁 / 인성 / 식상   (떠나는 쪽을 반영)
outcome 미입력                → 인성 / 비겁 / 식상   (미분류 → 편향 없음)
```

**부수 해소:** `context.readiness`가 `intensity` 산출에 쓰이며 미사용 상태를 벗어났습니다(§6-9).
**게이트 결과:** 기존 픽스처 2종 무회귀 · `tsc --noEmit` 통과 · `eslint` 통과.

### Track B — 심볼릭 경화 (사람 검증 대기, 병행)

| | 내용 | 차단 대상 |
| --- | --- | --- |
| **B1** | 유파 파라미터 확정 (§7-A) | **A1을 차단하지 않음** (§7-4 결정 완료) |
| **B2** | 골든 케이스 40건 — Claude Code가 골격 생성, **정답값은 사람이 만세력 대조** | **100% 전환만 차단.** A/B 노출은 차단하지 않음 |
| **B3** | `chart/adapter.ts` 분리 + `meta.solarTermBoundary` + §6-3·§6-6 수정 | — |

**골든 케이스 구성** (최소 40건): 입춘 전후 3 · 각 절(節) 경계 12 · 표준시 +8:30 구간 3 · 서머타임 구간 3 · 자시 경계 5 · 윤달 3 · 시간 미상 2 · 일반 회귀 9+. 해외 출생 2건은 현재 미지원이라 §7-7 결정 후 편입합니다. 불일치가 나오면 라이브러리 버그일 수 있으므로, 우리 코드를 고치기 전에 어느 쪽 문제인지 먼저 분리 리포트합니다.

**합류점:** A4의 100% 전환은 B2 통과를 요구합니다. 그 전까지는 feature flag 하 부분 노출로 운영합니다.

---

## 6. 착수 전 처리 대상

### 6-A. 하드 블로커 — LLM 첫 호출 전에 반드시 (Phase A0)

1. **무인증 공개 엔드포인트 + 유료 호출 = 과금 사고.**
   `/api/reading/session`에는 App Check도 속도 제한도 없습니다(ROADMAP M1-A). 지금은 최악이 Firestore 문서 폭주지만, **LLM이 붙는 순간 스크립트 하나가 임의 금액을 청구시킬 수 있습니다.** M1-A(App Check + IP 기준 속도 제한)를 이 계획의 선행 조건으로 승격합니다.
   추가 방어: 세션당·일간 예산 상한, 환경변수 킬스위치, 동일 입력 해시 캐시.

2. **개인정보 처리위탁 고지 갱신.**
   `story`가 Anthropic API로 나가면 **국외 처리위탁이 발생합니다.** 현재 랜딩 모달 고지(`if-saju-experience.tsx:625-628`)에는 수집·보관·미수집 항목만 있고 **수탁자 표기가 전혀 없습니다.** 생년월일시 + 과거 사건 서술은 민감도가 높고 만 14세 게이트를 두고 있으므로, `/privacy` 라우트(M1-B)에 수탁자·목적·국가·보유기간을 명시하기 전에는 원문을 외부로 보내지 않습니다.
   완화안(선택): L2 LLM 폴백에 원문 대신 **정규화·부분 마스킹 텍스트**만 전송. 단 evidence 인용 품질이 떨어지므로 §7-9에서 결정 필요.

### 6-B. 코드 결함 (해당 Phase에 포함)

3. **`hourConfidenceBand()`가 명식과 다른 시각을 씀** (`:144-161`) — `+09:00` 하드코딩 + 자체 `equationOfTime()` + `(lon-135)*4`로 진태양시를 재계산합니다. 본체는 `manseryeok`이 IANA tz로 1954–61 `+08:30`과 서머타임까지 반영하므로, **해당 구간 출생자는 시주 경계 판정과 실제 시주의 근거 시각이 서로 다릅니다.** → B3에서 어댑터 산출값으로 교체.
4. **`AXIS_STORY` 48줄이 dead code** (`:77-124`) — `resultFor()`가 내부에 `stories`를 다시 정의합니다(`:436` 부근). 두 벌이 미묘하게 다르고(카테고리 치환 유무) 한쪽만 고치면 조용히 어긋납니다. → A3에서 통합.
5. **세운 부재 · 월운 근사** (`pillarForMonth()`, `:249`) — 매달 15일 정오로 간지를 뽑습니다. 절입이 15일 근처인 달은 월간(月干)이 틀어질 수 있고, 세운은 `flow.year`로 간접 참조될 뿐입니다. → L3 작업 시.
6. **`timeUnknown`일 때 `hour=12` 임의 대입** (`:170`) — "임의 보정 금지" 원칙의 기존 위반. 하위 판정 대부분은 시주를 제외하지만 `hourElement`·`voidBranches`·`luckPillars`에는 12시가 반영됩니다. → B3에서 UNKNOWN 타입 전파.
7. **형(刑) 규칙 불완전** (`:239-248`) — 자형은 진·오·유·해만, 삼형은 인사·사신·축술·술미 쌍만. → L3 외부화 시 §7-5 확인.
8. **해외 출생 미지원** — `CITY_LONGITUDE` 국내 11개뿐, 미상은 127.5° 폴백. 입력 폼도 자유 텍스트라 경도를 얻을 수 없습니다. → §7-7 결정.
9. **`context.readiness` 미사용** — L2의 `intensity` 산출에 투입해 해소합니다(§3.1).
10. **`classifySafety()` 우회 가능** (ROADMAP M1-C) — L2가 텍스트를 정규화하게 되므로 **정규화 로직을 공유**하면 두 작업이 합쳐집니다.

---

## 7. 사람에게 확인받을 것

### 7-A. 유파 파라미터 (임의 결정 금지)

1. **자시 처리** — 현재 `dayBoundary: 'jasi'`(23시부터 다음날, 일주·시주 모두 이동). `'splitJasi'`(일주 유지, 시주 천간만 이동)로 갈 것인가? **골든 케이스의 정답값 자체가 바뀝니다.**
2. **신강·신약 임계** — 득령 40 + 득지 25 + 득세 25 + 계절보정 최대 10 → 45/55 경계. 이 점수식과 임계를 확정할 것.
3. **용신 취법** — 현재 억부만(신강 → 식상·재성·관성 / 신약 → 인성·비겁). 조후·통관을 넣을 것인가?
4. ~~**관계 도메인의 십신 매핑**~~ — **결정 완료(2026-08-16): 배우자궁(일지) 기준.** 성별 입력에 의존하지 않고 명식에서 도출합니다. 설계는 §3.1-a. 전통 규칙(남명 재성 / 여명 관성)은 채택하지 않습니다.
5. **형(刑) 범위** — 삼형(인사신·축술미)·자형(진오유해)·무례지형(자묘) 중 어디까지, 강도는?
6. **`DOMAIN_BY_AXIS` 붕괴** — 식상과 인성이 **둘 다 "학습·내면"** 입니다(`:25-31`). 5축이 4도메인으로 접히며 `secondaryAxis` 선택이 왜곡됩니다. 식상을 "표현·창작"으로 분리할 것인가?

### 7-B. 제품·운영 결정

7. **해외 출생 지원 여부** (§6-8) — 지원하면 입력 폼에 국가/도시 추가 필요.
8. **LLM 예산** — 세션당 상한, 일간 상한, 킬스위치 임계. L5 1회는 입력 ~3K·출력 ~1.5K 규모이며 **adaptive thinking 토큰이 출력에 합산 과금**됩니다. 정확한 단가는 착수 시 `count_tokens`로 실측합니다.
9. **원문 전송 범위** (§6-A-2) — 원문 그대로 보낼 것인가, 마스킹할 것인가. evidence 인용 품질과 직결됩니다.
10. **UNKNOWN 원문 보관** — 세션과 같은 7일 TTL이면 온톨로지 개선 주기가 주 1회로 묶입니다. 그대로 갈지, 식별 요소 제거 후 더 오래 둘지(처리방침 수정 필요).

---

## 8. 수용 기준

| 항목 | 기준 | 측정 |
| --- | --- | --- |
| **사용자 입력 반영** | 같은 원국·같은 카테고리라도 갈림길이 다르면 축 집합 또는 서사가 달라짐 | `scripts/fork-fixtures.ts` |
| L2 커버리지 | `unknownRate` 추적 가능 + 하향 추세, < 20% | 주간 배치 |
| L2 안전성 | 미분류 시 임의 기본값 없음 | 코드 리뷰 |
| L5 충실성 | 인용이 원문 부분문자열임을 100% 보장 | `fidelity` 결정론 검사 |
| L5 폴백 | `hallucinationRate` 측정 가능, 임계 초과 시 템플릿 자동 전환 | 폴백 강제 테스트 |
| 비용 통제 | 킬스위치 ON에서 서비스 완전 동작 · 예산 상한 도달 시 자동 폴백 | 부하 테스트 |
| L1 정확성 | 골든 40건 100% | `scripts/chart-golden.ts` |
| L3/L4 결정론 | 100회 반복 동일 (슬롯 배치는 명시적 제외) | `scripts/determinism.ts` |
| 회귀 | 기존 플로우·7일 TTL·봉인 커밋먼트 유지 | 기존 픽스처 2종 무변경 통과 |

---

## 9. 다음 한 걸음

1. **A1 착수 — 지금 바로 가능.** `ontology.ts` 초판 + `rankedAxes` bias 인자. §7-4가 결정되어 **차단 항목이 없습니다.** LLM 없이, 비용 0으로 사용자 입력이 처음 서사에 반영되는 지점입니다.
2. **A0 착수** — App Check + 속도 제한 + 처리위탁 고지. A1과 병행 가능하되, **LLM 첫 호출(A2) 전에는 반드시 끝나야 합니다.**
3. **§7-1(자시 처리) 답** — B2 골든 케이스의 정답값을 정합니다. A 트랙은 막지 않습니다.
4. 나머지 §7-A(2·3·5·6)는 해당 층 작업 시점에 확정합니다.
