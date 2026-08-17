"use client";

import { FormEvent, type CSSProperties, type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiUrl } from "@/lib/api-base";
import type { BirthInput, EventCategory, ReadingInput, ReadingResult, TenGodAxis } from "@/lib/reading-types";
import { currentAuthState, ensureAnonymousAuth, linkGoogleAccount, requestHeaders, warmAppCheck, type AuthState } from "@/lib/firebase-client";
import { APP_VERSION, IS_TOSS_APP } from "@/lib/platform";

type Stage = "landing" | "birth" | "event" | "cards" | "reading";
type CardSlot = 0 | 1 | 2;
type SessionEnvelope = {
  sessionId: string;
  choiceCommitments: string[];
  sessionCommitment: string;
};
type Reveal = {
  slot: CardSlot;
  choiceId: string;
  title: string;
  choiceText: string;
  choiceAxis: TenGodAxis;
  nonce: string;
  commitment: string;
  sessionId: string;
};
type CachedReading = {
  savedAt: number;
  session: SessionEnvelope;
  reveal: Reveal;
  overview: string[];
  timeline: ReadingResult["timeline"];
  balance: { gains: string[]; losses: string[] };
  commonFate: string;
  basis: ReadingResult["basis"];
  closing: { closingLine: string; uncertaintyNote: string };
};

const CATEGORIES: Array<{ label: EventCategory; glyph: string }> = [
  { label: "이직", glyph: "↗" },
  { label: "이사", glyph: "⌂" },
  { label: "연애", glyph: "◇" },
  { label: "진학", glyph: "⌁" },
  { label: "창업", glyph: "＋" },
  { label: "투자", glyph: "◒" },
  { label: "가족", glyph: "○" },
  { label: "기타", glyph: "…" },
];

/**
 * 카테고리별 안내.
 *
 * placeholder 는 **질문**이고 sample 은 **채워진 답변**이다. 둘은 역할이 다르다 —
 * 처음 쓰는 사람에게는 "무엇을 묻는지"보다 "어느 정도로 쓰면 되는지"가 막막하다.
 *
 * sample 의 세 문장은 각각 story / outcome / alternative 에 대응한다.
 * 서사 품질은 **구체성에 비례**하므로(고유명사·숫자·기간이 그대로 인용된다),
 * 예시도 그 수준으로 적어 둔다.
 */
type CategoryGuide = {
  helper: string;
  placeholder: string;
  sample: { story: string; outcome: string; alternative: string };
};

const EXAMPLES: Record<EventCategory, CategoryGuide> = {
  이직: {
    helper: "예: 안정적인 회사를 떠날지 고민했던 순간",
    placeholder: "그때 어떤 선택 앞에 서 있었나요? 당시 상황과 실제로 고른 길을 들려주세요.",
    sample: {
      story: "10년 다닌 회사에서 팀장 승진 제안을 받았습니다. 같은 시기에 작은 회사에서 창업 멤버로 와 달라는 연락이 왔고, 두 달을 고민했습니다.",
      outcome: "승진을 받아들이고 남았습니다. 안정이 필요한 시기였습니다.",
      alternative: "그때 창업 쪽으로 갔다면 어땠을까 아직도 생각합니다.",
    },
  },
  이사: {
    helper: "예: 익숙한 도시를 떠날 기회가 왔던 순간",
    placeholder: "어디로, 왜 옮길지 고민했나요? 마음에 남은 갈림길을 적어주세요.",
    sample: {
      story: "서울에서 15년을 살다가 고향에 일자리가 났습니다. 부모님은 내려오길 바라셨고, 저는 여기서 쌓은 관계가 아까웠습니다.",
      outcome: "서울에 남았습니다.",
      alternative: "내려갔다면 부모님 곁에 있었을 텐데 하는 마음이 남습니다.",
    },
  },
  연애: {
    helper: "예: 관계를 이어갈지 멈출지 고민했던 순간",
    placeholder: "그 관계에서 어떤 선택을 했고, 무엇이 가장 마음에 남았나요?",
    sample: {
      story: "3년 만난 사람과 결혼 이야기가 나왔습니다. 서로를 아꼈지만 살고 싶은 도시가 달랐고, 반년을 미뤘습니다.",
      outcome: "결국 각자의 길로 갔습니다.",
      alternative: "제가 먼저 옮겨 갔다면 달랐을까 생각합니다.",
    },
  },
  진학: {
    helper: "예: 원하는 전공과 현실적인 선택 사이",
    placeholder: "당시 어떤 두 길 사이에서 고민했는지 적어주세요.",
    sample: {
      story: "하고 싶던 전공과 취업이 잘 되는 전공 사이에서 고민했습니다. 집안 형편도 마음에 걸렸습니다.",
      outcome: "취업이 잘 되는 쪽을 골랐습니다.",
      alternative: "원하던 공부를 계속했다면 지금 무엇을 하고 있을지 궁금합니다.",
    },
  },
  창업: {
    helper: "예: 제안을 받아들일지 안정에 남을지",
    placeholder: "그 기회와 망설임, 실제 선택을 구체적으로 들려주세요.",
    sample: {
      story: "준비하던 아이템으로 투자 제안을 받았습니다. 대출도 필요했고 가족을 설득해야 했습니다.",
      outcome: "결국 시작하지 않았습니다.",
      alternative: "그때 밀어붙였다면 어떻게 됐을지 자주 떠올립니다.",
    },
  },
  투자: {
    helper: "예: 큰 결정을 앞두고 주저했던 순간",
    placeholder: "어떤 조건과 두려움이 선택에 영향을 주었나요?",
    sample: {
      story: "모아 둔 돈 전부가 들어가는 결정이었습니다. 주변에서는 지금이라고 했지만 확신이 서지 않았습니다.",
      outcome: "결국 넣지 않고 두었습니다.",
      alternative: "들어갔다면 지금 다른 자리에 있었을까 싶습니다.",
    },
  },
  가족: {
    helper: "예: 가족을 위해 내 계획을 바꿨던 순간",
    placeholder: "누구의 잘잘못보다, 당시 내가 놓인 선택을 중심으로 적어주세요.",
    sample: {
      story: "부모님이 편찮으셔서 제 계획을 미뤄야 하는 시기였습니다. 형제들과 역할을 나누는 문제도 있었습니다.",
      outcome: "제 일을 접고 곁에 있기로 했습니다.",
      alternative: "그때 제 길을 갔다면 지금 어땠을까 생각합니다.",
    },
  },
  기타: {
    helper: "오래 마음에 남아 있는 한 번의 갈림길",
    placeholder: "그때 무엇을 선택했고, 고르지 않은 길은 무엇이었나요?",
    sample: {
      story: "오래 준비하던 일을 접을지 이어갈지 정해야 했습니다. 시간과 돈이 더 들어갈 상황이었습니다.",
      outcome: "접기로 했습니다.",
      alternative: "조금만 더 버텼다면 달랐을지 궁금합니다.",
    },
  },
};
const CALENDAR_TYPES = [
  { value: "solar", label: "양력" },
  { value: "lunar", label: "음력" },
] as const;
const BIRTH_CITIES = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "제주", "강릉", "전주"] as const;
const OTHER_BIRTH_CITY = "기타";

const EMPTY_BIRTH: BirthInput = { date: "", calendarType: "solar", lunarLeapMonth: false, time: "", timeUnknown: false, city: "서울", gender: "응답 안 함" };
const EMPTY_EVENT: ReadingInput["event"] = { category: "이직", date: "", story: "", outcome: "", alternative: "" };
const EMPTY_CONTEXT: ReadingInput["context"] = { readiness: 3, freedom: 3, fear: 3 };
const CARD_SLOTS: readonly CardSlot[] = [0, 1, 2];

const CARD_SIGILS = [
  <svg key="fork" aria-hidden="true" className="card-sigil" viewBox="0 0 100 100">
    <circle className="sigil-halo" cx="50" cy="50" r="31" />
    <circle className="sigil-faint" cx="50" cy="50" r="22" />
    <path className="sigil-line" d="M50 20v30M50 50 31 72M50 50l19 22" />
    <path className="sigil-faint" d="M24 50h52" />
    <circle className="sigil-node" cx="50" cy="50" r="3.6" />
    <circle className="sigil-node subtle" cx="31" cy="72" r="2" />
    <circle className="sigil-node subtle" cx="69" cy="72" r="2" />
  </svg>,
  <svg key="orbit" aria-hidden="true" className="card-sigil" viewBox="0 0 100 100">
    <circle className="sigil-halo" cx="50" cy="50" r="27" />
    <ellipse className="sigil-line" cx="50" cy="50" rx="37" ry="14" transform="rotate(-28 50 50)" />
    <ellipse className="sigil-faint" cx="50" cy="50" rx="37" ry="14" transform="rotate(28 50 50)" />
    <path className="sigil-faint" d="M50 18v64" />
    <circle className="sigil-node" cx="50" cy="50" r="3.6" />
    <circle className="sigil-node subtle" cx="50" cy="23" r="2" />
  </svg>,
  <svg key="resolve" aria-hidden="true" className="card-sigil" viewBox="0 0 100 100">
    <path className="sigil-halo" d="m50 18 30 32-30 32-30-32Z" />
    <circle className="sigil-faint" cx="50" cy="50" r="23" />
    <path className="sigil-line" d="M28 50c10-19 34-19 44 0-10 19-34 19-44 0Z" />
    <path className="sigil-faint" d="M50 21v58M25 50h50" />
    <circle className="sigil-node" cx="50" cy="50" r="3.6" />
    <circle className="sigil-node subtle" cx="50" cy="27" r="2" />
    <circle className="sigil-node subtle" cx="50" cy="73" r="2" />
  </svg>,
] as const;

function CardArtwork({ slot }: { slot: CardSlot }) {
  return (
    <>
      <span className="card-frame" aria-hidden="true" />
      {CARD_SIGILS[slot]}
      <span className="card-wordmark" aria-hidden="true">만약사주</span>
    </>
  );
}

function cardVariant(slot: CardSlot) {
  return `card-variant-${slot + 1}`;
}

function Arrow({ direction = "right" }: { direction?: "left" | "right" }) {
  return <span aria-hidden="true" className={`arrow-icon ${direction === "left" ? "arrow-left" : ""}`}>→</span>;
}

function LockIcon({ open = false }: { open?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="lock-icon">
      <path d={open ? "M8.5 10V7.5a3.5 3.5 0 0 1 6.6-1.6" : "M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10"} />
      <rect x="5.5" y="10" width="13" height="10" rx="3" />
      <path d="M12 14v2" />
    </svg>
  );
}

function Brand() {
  return (
    <button className="brand" type="button" aria-label="만약사주 처음으로" onClick={() => window.location.reload()}>
      <span className="brand-mark" aria-hidden="true"><i /><i /></span>
      <span className="brand-copy">
        <strong>만약사주</strong>
        <small>가지 않은 운</small>
      </span>
    </button>
  );
}

/**
 * 슬라이더를 만지기 시작할 때 열려 있던 키보드를 내린다.
 *
 * **실기기에서만 나는 문제였다.** 이야기를 쓰고 나면 textarea 에 포커스가
 * 남고 가상 키보드가 떠 있다. 그 상태로 슬라이더를 움직이면 값이 바뀔 때마다
 * 레이아웃이 갱신되고, 모바일 브라우저는 그때 **포커스된 요소를 화면 안으로
 * 되돌린다.** 초점이 이야기 칸으로 옮겨간 것처럼 보이지만 실은 떠난 적이 없다.
 *
 * 데스크톱에는 가상 키보드도, 이 되돌리기 동작도 없다. 그래서 창을 모바일
 * 크기로 줄여 봐도 재현되지 않는다 — 화면 크기가 아니라 입력기의 문제다.
 */
function dismissKeyboard() {
  const active = document.activeElement;
  const isTextEntry = active instanceof HTMLTextAreaElement
    || (active instanceof HTMLInputElement && active.type !== "range");
  if (isTextEntry) active.blur();
}

function SliderField({ label, hint, low, high, value, onChange }: { label: string; hint: string; low: string; high: string; value: number; onChange: (value: number) => void }) {
  return (
    // 손가락이 닿는 순간 처리한다. 슬라이더 손잡이뿐 아니라 이 블록 어디를
    // 눌러도 걸리도록 label 에 둔다.
    <label className="slider-field" onPointerDown={dismissKeyboard}>
      <span className="slider-title"><span>{label}</span><output>{value}</output></span>
      <small className="slider-hint">{hint}</small>
      <input type="range" min="1" max="5" step="1" value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <span className="slider-ends"><span>{low}</span><span>{high}</span></span>
    </label>
  );
}

type Tab = "story" | "chart" | "archive" | "more";

type ChartSummary = {
  pillars: Array<{ label: string; korean: string; hanja: string; stemElement: string; branchElement: string; stemTenGod: string | null; branchTenGod: string }>;
  dayMaster: { korean: string; hanja: string; element: string };
  elements: Array<{ element: string; count: number }>;
  strength: { score: number; band: string };
  axes: Array<{ axis: string; count: number }>;
  luck: { available: boolean; reason: string | null; startAge: number; forward: boolean; pillars: Array<{ age: number; korean: string; current: boolean }> };
  timeUnknown: boolean;
  profileId: string;
};
type SavedItem = { id: string; createdAt: number; category: string; eventDate: string; title: string | null; slot: CardSlot | null };

/**
 * 하단 탭. **모바일에서만 보인다**(CSS `.bottom-nav`).
 *
 * 데스크톱은 스크롤 여유가 있어 하단 고정 바가 화면만 먹는다. 모바일에서는
 * 엄지 반경 안에 있는 유일한 자리라 앱처럼 쓰이려면 여기가 맞다.
 */
const ALL_TABS: Array<{ key: Tab; label: string; glyph: string }> = [
  { key: "story", label: "이야기", glyph: "◇" },
  { key: "chart", label: "내 사주", glyph: "☰" },
  { key: "archive", label: "보관함", glyph: "▤" },
  { key: "more", label: "더보기", glyph: "⋯" },
];

/**
 * 토스 미니앱에서는 보관함을 뺀다 — 구글 연동이 WebView 에서 성립하지
 * 않아 영영 비어 있을 탭이다(`lib/platform.ts`). 하단 바와 상단 바가 같은
 * 목록을 쓰므로 여기서 한 번 거르면 양쪽이 함께 맞는다.
 */
const TABS = ALL_TABS.filter((item) => !(IS_TOSS_APP && item.key === "archive"));

function BottomNav({ current, onSelect }: { current: Tab; onSelect: (tab: Tab) => void }) {
  return (
    <nav className="bottom-nav" aria-label="주요 화면">
      {TABS.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-current={current === item.key ? "page" : undefined}
          onClick={() => onSelect(item.key)}
        >
          <b aria-hidden="true">{item.glyph}</b>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

const ELEMENT_TONE: Record<string, string> = { 목: "wood", 화: "fire", 토: "earth", 금: "metal", 수: "water" };

/**
 * 내 사주 — 명식을 그 자체로 보여 준다.
 *
 * **해석하지 않는다.** 길흉·예언을 말하지 않고 계산된 것만 낸다. 서사(이야기 탭)가
 * 해석을 맡고, 여기는 그 서사가 무엇 위에 서 있는지를 보여 주는 자리다.
 *
 * LLM 이 붙지 않으므로 비용이 0이고, 골든 43건으로 정확성이 고정돼 있다.
 */
function ChartScreen({
  chart, error, hasBirth, onGoBirth, onRetry,
}: {
  chart: ChartSummary | null;
  error: string | null;
  hasBirth: boolean;
  onGoBirth: () => void;
  onRetry: () => void;
}) {
  if (!hasBirth) {
    return (
      <main className="tab-page">
        <p className="eyebrow"><span />내 사주</p>
        <h1>생년월일시를<br />먼저 알려주세요.</h1>
        <p className="tab-intro">같은 선택이라도 사람마다 치르는 대가가 다릅니다. 그 차이는 태어난 시각에서 나와요. 한 번 입력하면 이 기기에 저장돼 다시 묻지 않습니다.</p>
        <button className="primary-button" type="button" onClick={onGoBirth}>생년월일 입력하기 <Arrow /></button>
      </main>
    );
  }

  return (
    <main className="tab-page">
      <p className="eyebrow"><span />내 사주</p>
      <h1>내 명식</h1>
      {error && (
        <div className="error-panel" role="alert">
          <strong>{error}</strong>
          <button className="secondary-button" type="button" onClick={onRetry}>다시 계산하기</button>
        </div>
      )}
      {!error && !chart && <p className="tab-intro">계산하는 중이에요…</p>}
      {chart && (
        <>
          <p className="tab-intro">
            일간은 <b>{chart.dayMaster.korean}({chart.dayMaster.hanja})</b>, 오행으로는 <b>{chart.dayMaster.element}</b>입니다.
            사주에서 &lsquo;나&rsquo;를 가리키는 글자예요. <b>가지 않은 길의 대가가 사람마다 다른 이유</b>가 여기 있습니다.
          </p>

          <div className="pillar-grid">
            {chart.pillars.map((pillar) => (
              <div key={pillar.label} className={`pillar-card ${pillar.label === "일주" ? "is-day" : ""}`}>
                <span className="pillar-label">{pillar.label}</span>
                <span className="pillar-hanja">{pillar.hanja}</span>
                <span className="pillar-korean">{pillar.korean}</span>
                <span className="pillar-gods">
                  <i className={`el el-${ELEMENT_TONE[pillar.stemElement]}`}>{pillar.stemElement}</i>
                  {pillar.stemTenGod ?? "나"} · {pillar.branchTenGod}
                  <i className={`el el-${ELEMENT_TONE[pillar.branchElement]}`}>{pillar.branchElement}</i>
                </span>
              </div>
            ))}
          </div>
          {chart.timeUnknown && (
            <p className="chart-note">
              태어난 시각을 모르셔서 <b>시주는 빼고</b> 계산했어요. 임의로 채우면 명식 전체가 틀어집니다.
            </p>
          )}

          <h2 className="chart-heading">오행 분포</h2>
          <ul className="element-bars">
            {chart.elements.map((item) => (
              <li key={item.element}>
                <span className="element-name">{item.element}</span>
                <span className="element-track">
                  <i className={`el-${ELEMENT_TONE[item.element]}`} style={{ width: `${(item.count / (chart.timeUnknown ? 6 : 8)) * 100}%` }} />
                </span>
                <span className="element-count">{item.count}</span>
              </li>
            ))}
          </ul>

          <h2 className="chart-heading">기운의 세기</h2>
          <div className="more-card">
            <strong>{chart.strength.band} · {chart.strength.score}점</strong>
            <span>
              일간을 돕는 글자가 얼마나 있는지로 셉니다. <b>{chart.strength.band}</b>은 좋고 나쁨이 아니라
              어느 쪽으로 기울어 있는지를 말해요. 이야기 탭의 세 갈래를 고를 때 함께 쓰입니다.
            </span>
          </div>

          <h2 className="chart-heading">대운</h2>
          {chart.luck.available ? (
            <>
              <p className="tab-intro">
                {chart.luck.startAge}세부터 10년 단위로 바뀌며, {chart.luck.forward ? "순행" : "역행"}합니다.
              </p>
              <ul className="luck-list">
                {chart.luck.pillars.slice(0, 8).map((pillar) => (
                  <li key={pillar.age} className={pillar.current ? "current" : ""}>
                    <span>{pillar.age}세</span>
                    <b>{pillar.korean}</b>
                    {pillar.current && <em>지금</em>}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="chart-note">{chart.luck.reason}</p>
          )}

          <p className="chart-foot">
            유파 {chart.profileId} · 자시설·균시차 미적용 기준으로 계산했어요. 이 화면은 길흉을 말하지 않습니다.
          </p>
        </>
      )}
    </main>
  );
}

/**
 * 보관함.
 *
 * 목록은 요약만 받는다 — 서사 본문은 열었을 때만 온다. 항목을 누르면
 * 기존 스트림 경로로 재열람하며, 서버가 저장해 둔 결과를 그대로 내므로
 * **LLM 을 다시 부르지 않는다.**
 */
function ArchiveScreen({
  items, error, linked, onLink, onOpen, onRetry,
}: {
  items: SavedItem[] | null;
  error: string | null;
  linked: boolean;
  onLink: () => void;
  onOpen: (item: SavedItem) => void;
  onRetry: () => void;
}) {
  if (!linked) {
    return (
      <main className="tab-page">
        <p className="eyebrow"><span />보관함</p>
        <h1>후회는 한 번 읽고<br />정리되지 않습니다.</h1>
        <p className="tab-intro">
          그래서 다시 꺼내 볼 수 있게 해 둡니다. 결과 화면에서 <b>보관하기</b>를 누르면
          이곳에 쌓여요. 기기를 바꿔도 남으려면 구글 계정 연결이 필요합니다.
        </p>
        <button className="primary-button" type="button" onClick={onLink}>구글 계정으로 시작하기</button>
      </main>
    );
  }

  return (
    <main className="tab-page">
      <p className="eyebrow"><span />보관함</p>
      <h1>보관한 이야기</h1>
      {error && (
        <div className="error-panel" role="alert">
          <strong>{error}</strong>
          <button className="secondary-button" type="button" onClick={onRetry}>다시 불러오기</button>
        </div>
      )}
      {!error && items === null && <p className="tab-intro">불러오는 중이에요…</p>}
      {!error && items?.length === 0 && (
        <p className="tab-intro">아직 보관한 이야기가 없어요. 결과 화면 아래에서 보관할 수 있습니다.</p>
      )}
      {!!items?.length && (
        <ul className="archive-list">
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => onOpen(item)} disabled={item.slot === null}>
                <span className="archive-title">{item.title ?? "열지 않은 이야기"}</span>
                <span className="archive-meta">{item.category} · {item.eventDate}</span>
                <span className="archive-date">
                  {new Date(item.createdAt).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })}에 봄
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/**
 * 결과를 본 **뒤에** 나오는 보관 제안.
 *
 * 답변 앞에 로그인 벽을 세우지 않는 이유: 그 시점의 사용자는 이미 생년월일시와
 * 최대 1,400자를 썼고 카드까지 골랐다. **매몰비용이 최대인 지점에서 벽을 만나면
 * 이탈한다.** 게다가 "봉인된 카드를 연다"는 이 제품의 연출 자체가 무너진다.
 *
 * 여기서는 가치를 이미 경험했으므로 거절해도 잃는 게 없다.
 */
function SaveBox({ state, linked, onSave }: { state: "idle" | "working" | "saved" | "failed"; linked: boolean; onSave: () => void }) {
  // 토스 미니앱에서는 저장 자체가 성립하지 않는다(`lib/platform.ts`).
  // 7일 뒤 사라진다는 사실은 알려야 하지만, 누를 수 없는 버튼은 빼는 게 맞다.
  if (IS_TOSS_APP) {
    return (
      <div className="save-box">
        <strong>이 이야기는 7일 뒤 사라집니다.</strong>
        <span>다시 보고 싶다면 지금 읽어 두세요. 보관 기능은 준비하고 있어요.</span>
      </div>
    );
  }
  if (state === "saved") {
    return (
      <div className="save-box saved">
        <strong>보관했어요.</strong>
        <span>이 이야기는 1년 동안 다시 볼 수 있어요. 언제든 지울 수 있습니다.</span>
      </div>
    );
  }
  return (
    <div className="save-box">
      <strong>이 이야기, 다시 꺼내 보실 건가요?</strong>
      <span>
        후회는 한 번 읽고 정리되지 않습니다. 지금은 <b>7일 뒤 자동으로 지워집니다.</b>{" "}
        구글 계정으로 저장하면 1년 동안 다시 볼 수 있어요. 저장하지 않아도 결과는
        그대로 보실 수 있습니다.
      </span>
      <button type="button" className="secondary-button" onClick={onSave} disabled={state === "working"}>
        {state === "working" ? <><span className="spinner" /> 저장하는 중</> : linked ? "이 이야기 보관하기" : "구글 계정으로 저장하기"}
      </button>
      {state === "failed" && <small className="save-error">저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.</small>}
    </div>
  );
}

/**
 * 처음 쓰는 사람만 보는 예시.
 *
 * 익숙해지면 방해가 되므로 한 번 닫으면 다시 뜨지 않는다(localStorage).
 * **자동으로 채워 넣지 않는다** — 예시가 그대로 제출되면 남의 이야기로
 * 사주를 보게 된다. 읽고 자기 말로 쓰게 하는 것이 목적이다.
 */
function ExampleHint({ guide, onDismiss }: { guide: CategoryGuide; onDismiss: () => void }) {
  return (
    <aside className="example-hint">
      <div className="example-hint-head">
        <span>이렇게 적으면 좋아요</span>
        <button type="button" onClick={onDismiss} aria-label="예시 다시 보지 않기">다시 보지 않기</button>
      </div>
      <p className="example-line"><b>그때의 이야기</b>{guide.sample.story}</p>
      <p className="example-line"><b>실제로는</b>{guide.sample.outcome}</p>
      <p className="example-line"><b>다른 길</b>{guide.sample.alternative}</p>
      <p className="example-foot">구체적으로 쓸수록 좋습니다. 적어 주신 표현이 결과 문장에 그대로 인용돼요.</p>
    </aside>
  );
}

/**
 * 봉인 해시. **없으면 null 을 돌려주고 끝낸다 — 던지지 않는다.**
 *
 * `crypto.subtle` 은 보안 컨텍스트에서만 있고, WebView 처럼 그 판정이
 * 브라우저와 다른 환경이 있다. 봉인 확인은 "서버가 카드를 바꿔치기하지
 * 않았다"를 **보여 주는** 부가 기능이다. 그걸 못 한다고 이야기 자체를
 * 못 보게 만들면 손해가 더 크다.
 *
 * 확인하지 못하면 화면에 "확인하는 중"으로 남는다. 거짓으로 "일치한다"고
 * 말하지는 않으므로 사용자를 속이지 않는다.
 */
async function sha256(value: string): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch (error) {
    console.error("봉인 해시 계산 실패", error);
    return null;
  }
}

export function IfSajuExperience() {
  const [stage, setStage] = useState<Stage>("landing");
  const [ageGate, setAgeGate] = useState<"checking" | "open" | "accepted" | "blocked">("checking");
  const [birth, setBirth] = useState<BirthInput>(EMPTY_BIRTH);
  const [event, setEvent] = useState<ReadingInput["event"]>(EMPTY_EVENT);
  const [context, setContext] = useState(EMPTY_CONTEXT);
  // 서버 렌더와 첫 클라이언트 렌더가 어긋나면 안 되므로 false 로 시작하고,
  // localStorage 를 읽은 뒤에만 켠다.
  const [showExample, setShowExample] = useState(false);
  const [auth, setAuth] = useState<AuthState>(null);
  const [saveState, setSaveState] = useState<"idle" | "working" | "saved" | "failed">("idle");
  const [tab, setTab] = useState<Tab>("story");
  const [savedList, setSavedList] = useState<SavedItem[] | null>(null);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [chartSummary, setChartSummary] = useState<ChartSummary | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const [showOptional, setShowOptional] = useState(false);
  const [session, setSession] = useState<SessionEnvelope | null>(null);
  const [candidate, setCandidate] = useState<CardSlot | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<CardSlot | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [overview, setOverview] = useState<string[]>([]);
  const [timeline, setTimeline] = useState<ReadingResult["timeline"]>([]);
  const [balance, setBalance] = useState<{ gains: string[]; losses: string[] } | null>(null);
  const [commonFate, setCommonFate] = useState("");
  const [basis, setBasis] = useState<ReadingResult["basis"] | null>(null);
  const [closing, setClosing] = useState<{ closingLine: string; uncertaintyNote: string } | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sealVerified, setSealVerified] = useState(false);
  const [error, setError] = useState<{ message: string; support?: string } | null>(null);
  const [feedback, setFeedback] = useState("");
  const [showInfo, setShowInfo] = useState(false);
  const [sheetOrigin, setSheetOrigin] = useState({ x: 0, y: 180 });
  const mainRef = useRef<HTMLElement>(null);
  const decisionRef = useRef<HTMLElement>(null);
  const ageRef = useRef<HTMLElement>(null);
  const infoRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // App Check 토큰을 미리 받아 두면 첫 API 호출의 지연이 줄어든다.
  useEffect(() => { warmAppCheck(); }, []);

  // 접속하면 조용히 익명 로그인한다. 화면에 아무 변화도 없다.
  // 목적은 통계와 속도 제한 정확도이지 이용 제한이 아니다 — 실패해도 그냥 쓴다.
  useEffect(() => {
    void ensureAnonymousAuth().then(() => currentAuthState()).then(setAuth).catch(() => setAuth(null));
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const accepted = localStorage.getItem("ifsaju-age-confirmed") === "yes";
      setAgeGate(accepted ? "accepted" : "open");
      // 예시는 처음 쓰는 사람에게만. 한 번 닫으면 다시 뜨지 않는다.
      setShowExample(localStorage.getItem("ifsaju-example-seen") !== "yes");
      const cached = localStorage.getItem("ifsaju-birth");
      if (cached) {
        try { setBirth({ ...EMPTY_BIRTH, ...JSON.parse(cached) }); } catch { /* ignore invalid local cache */ }
      }
      const cachedReading = localStorage.getItem("ifsaju-last-reading");
      if (cachedReading) {
        try {
          const reading = JSON.parse(cachedReading) as CachedReading;
          if (Date.now() - reading.savedAt < 7 * 24 * 60 * 60 * 1000) {
            setSession(reading.session);
            setReveal(reading.reveal);
            setSelectedSlot(reading.reveal.slot);
            setOverview(reading.overview);
            setTimeline(reading.timeline);
            setBalance(reading.balance);
            setCommonFate(reading.commonFate);
            setBasis(reading.basis);
            setClosing(reading.closing);
            setSealVerified(true);
            setStage("reading");
          } else localStorage.removeItem("ifsaju-last-reading");
        } catch { localStorage.removeItem("ifsaju-last-reading"); }
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (stage !== "landing") {
      requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: false }));
    }
  }, [stage]);

  useEffect(() => {
    const dialog = showInfo
      ? infoRef.current
      : candidate !== null
        ? decisionRef.current
        : ageGate === "open" || ageGate === "blocked"
          ? ageRef.current
          : null;
    if (!dialog) return;

    const shell = dialog.closest(".app-shell");
    const background = shell
      ? Array.from(shell.children).filter((child): child is HTMLElement => child instanceof HTMLElement && !child.contains(dialog))
      : [];
    const previousOverflow = document.body.style.overflow;
    background.forEach((element) => { element.inert = true; });
    document.body.style.overflow = "hidden";
    const focusableSelector = "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex='-1'])";
    const frame = requestAnimationFrame(() => {
      (dialog.querySelector<HTMLElement>("[data-autofocus]") ?? dialog.querySelector<HTMLElement>(focusableSelector) ?? dialog).focus({ preventScroll: true });
    });

    function keepFocusInside(eventObject: KeyboardEvent) {
      if (eventObject.key === "Escape") {
        if (showInfo) setShowInfo(false);
        else if (candidate !== null) setCandidate(null);
        return;
      }
      if (eventObject.key !== "Tab") return;
      const focusable = Array.from(dialog!.querySelectorAll<HTMLElement>(focusableSelector));
      if (!focusable.length) {
        eventObject.preventDefault();
        dialog!.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (eventObject.shiftKey && document.activeElement === first) {
        eventObject.preventDefault();
        last.focus();
      } else if (!eventObject.shiftKey && document.activeElement === last) {
        eventObject.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", keepFocusInside);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keepFocusInside);
      background.forEach((element) => { element.inert = false; });
      document.body.style.overflow = previousOverflow;
      if (openerRef.current?.isConnected) openerRef.current.focus({ preventScroll: true });
    };
  }, [ageGate, candidate, showInfo]);

  useEffect(() => {
    if (!session || !reveal || !balance || !basis || !closing || overview.length < 2 || timeline.length < 3) return;
    const cached: CachedReading = { savedAt: Date.now(), session, reveal, overview, timeline, balance, commonFate, basis, closing };
    localStorage.setItem("ifsaju-last-reading", JSON.stringify(cached));
  }, [balance, basis, closing, commonFate, overview, reveal, session, timeline]);

  const step = stage === "birth" ? 1 : stage === "event" ? 2 : stage === "cards" ? 3 : stage === "reading" ? 4 : 0;
  const input = useMemo<ReadingInput>(() => ({ birth, event, context }), [birth, event, context]);
  const birthCitySelection = BIRTH_CITIES.find((city) => city === birth.city) ?? OTHER_BIRTH_CITY;

  function acceptAge() {
    localStorage.setItem("ifsaju-age-confirmed", "yes");
    setAgeGate("accepted");
  }

  function openInfo(eventObject: ReactMouseEvent<HTMLButtonElement>) {
    openerRef.current = eventObject.currentTarget;
    setShowInfo(true);
  }

  function previewCard(slot: CardSlot, eventObject: ReactMouseEvent<HTMLButtonElement>) {
    const rect = eventObject.currentTarget.getBoundingClientRect();
    openerRef.current = eventObject.currentTarget;
    setSheetOrigin({
      x: rect.left + rect.width / 2 - window.innerWidth / 2,
      y: rect.top + rect.height / 2 - window.innerHeight / 2,
    });
    setCandidate(slot);
  }

  function submitBirth(eventObject: FormEvent) {
    eventObject.preventDefault();
    const city = birth.city.trim();
    if (!birth.date || (!birth.timeUnknown && !birth.time) || !city) return;
    const normalizedBirth = { ...birth, city };
    setBirth(normalizedBirth);
    localStorage.setItem("ifsaju-birth", JSON.stringify(normalizedBirth));
    // 출생 정보가 바뀌면 이전 명식은 남의 것이다. 다음에 「내 사주」를 열 때 다시 계산한다.
    setChartSummary(null);
    setStage("event");
  }

  async function prepareCards(eventObject: FormEvent) {
    eventObject.preventDefault();
    if (!event.date || event.story.trim().length < 10) return;
    setIsPreparing(true);
    setError(null);
    // 어느 단계에서 넘어졌는지 남긴다. 예전에는 네 가지 실패가 전부
    // "연결이 불안정해요" 한 줄로 뭉개져, 화면만 보고는 원인을 좁힐 수
    // 없었다(토스 WebView 에서 실제로 그 벽에 부딪혔다).
    let step: "AUTH" | "NET" | "PARSE" | "SEAL" = "AUTH";
    try {
      const headers = { "Content-Type": "application/json", ...(await requestHeaders()) };

      step = "NET";
      const response = await fetch(apiUrl("/api/reading/session"), {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      });

      step = "PARSE";
      const data = await response.json();
      if (!response.ok) {
        setError({ message: data.message ?? "봉인을 준비하지 못했어요.", support: data.support });
        return;
      }

      // 여기서부터는 세션이 이미 만들어졌다. 남은 건 봉인 확인뿐이고,
      // 그건 실패해도 이야기를 막지 않는다(sha256 이 null 을 돌려준다).
      step = "SEAL";
      setSession(data);
      const recomputed = await sha256([...data.choiceCommitments].sort().join("|"));
      setSealVerified(recomputed !== null && recomputed === data.sessionCommitment);
      setStage("cards");
    } catch (error) {
      console.error(`봉인 준비 실패 (${step})`, error);
      setError({ message: `연결이 잠시 불안정해요. 입력은 그대로 두었으니 다시 시도해 주세요. (${step})` });
    } finally {
      setIsPreparing(false);
    }
  }

  async function openCard() {
    if (candidate === null || !session || isStreaming) return;
    const slot = candidate;
    setCandidate(null);
    // 세션 생성 시 받아 둔 커밋먼트와 교차 검증한다 — 서버가 다른 카드를
    // 내주지 않았음을 확인하는 유일한 방법이다.
    await streamReading(session.sessionId, slot, session.choiceCommitments[slot]);
  }

  /**
   * 카드를 열고 본문을 받는다. 최초 공개와 재열람이 같은 경로를 쓴다.
   *
   * 재열람은 LLM 을 다시 부르지 않는다 — 서버가 `firstSelection` 으로 막고
   * 저장된 결과를 그대로 낸다. 보관함에서 여는 것도 여기로 온다.
   *
   * `expectedCommitment` 는 세션 생성 시 받은 목록의 값이다. 보관함에서
   * 열 때는 그 목록이 없으므로 **교차 검증만 생략**하고 해시 자체 검증은 한다.
   */
  async function streamReading(sessionId: string, slot: CardSlot, expectedCommitment?: string) {
    if (isStreaming) return;
    setSelectedSlot(slot);
    setOverview([]);
    setTimeline([]);
    setBalance(null);
    setCommonFate("");
    setBasis(null);
    setClosing(null);
    setReveal(null);
    setFeedback("");
    setSaveState("idle");
    setStage("reading");
    setIsStreaming(true);
    setError(null);
    try {
      const response = await fetch(apiUrl("/api/reading/stream"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await requestHeaders()) },
        body: JSON.stringify({ sessionId, slot }),
      });
      if (!response.ok || !response.body) {
        const data = await response.json();
        throw new Error(data.message ?? "선택한 길을 읽지 못했어요.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          const chunk = JSON.parse(line);
          if (chunk.type === "reveal") {
            setReveal(chunk.data);
            const verified = await sha256(`${chunk.data.sessionId}|${chunk.data.choiceId}|${chunk.data.choiceText}|${chunk.data.nonce}`);
            const crossChecked = expectedCommitment === undefined || expectedCommitment === chunk.data.commitment;
            setSealVerified(verified === chunk.data.commitment && crossChecked);
          }
          if (chunk.type === "overview") setOverview((current) => [...current, chunk.data.paragraph]);
          if (chunk.type === "timeline") setTimeline((current) => [...current, chunk.data.item]);
          if (chunk.type === "balance") setBalance(chunk.data);
          if (chunk.type === "commonFate") setCommonFate(chunk.data.text);
          if (chunk.type === "basis") setBasis(chunk.data);
          if (chunk.type === "closing") setClosing(chunk.data);
          if (chunk.type === "done") setIsStreaming(false);
        }
      }
    } catch (streamError) {
      setError({ message: streamError instanceof Error ? streamError.message : "선택하신 카드는 그대로예요. 이 길의 이후를 다시 읽어 주세요." });
      setIsStreaming(false);
    }
  }

  function resetEvent() {
    localStorage.removeItem("ifsaju-last-reading");
    setEvent(EMPTY_EVENT);
    setContext(EMPTY_CONTEXT);
    setSession(null);
    setSelectedSlot(null);
    setReveal(null);
    setOverview([]);
    setTimeline([]);
    setBalance(null);
    setCommonFate("");
    setBasis(null);
    setClosing(null);
    setFeedback("");
    setError(null);
    setStage("event");
  }

  async function sendFeedback(value: string) {
    if (!session || feedback) return;
    setFeedback(value);
    await fetch(apiUrl("/api/feedback"), { method: "POST", headers: { "Content-Type": "application/json", ...(await requestHeaders()) }, body: JSON.stringify({ sessionId: session.sessionId, value }) });
  }

  /** 보관함 목록. 탭을 열 때와 저장 직후에 부른다. */
  const loadArchive = useCallback(async () => {
    setSavedError(null);
    try {
      const response = await fetch(apiUrl("/api/reading/saved"), { headers: await requestHeaders() });
      if (response.status === 401) { setSavedList(null); return; }
      if (!response.ok) throw new Error("목록을 불러오지 못했어요.");
      const data = (await response.json()) as { readings: SavedItem[] };
      setSavedList(data.readings);
    } catch (error) {
      setSavedError(error instanceof Error ? error.message : "목록을 불러오지 못했어요.");
    }
  }, []);

  /**
   * 탭 전환. 보관함을 열 때 그 자리에서 목록을 부른다.
   *
   * effect 로 하지 않는 이유: 탭 상태를 보고 부르면 "왜 요청이 나갔는지"가
   * 사용자 동작과 분리된다. 여기서 부르면 누른 것과 요청이 한자리에 있다.
   */
  /** 명식 계산. 순수 계산이라 LLM 도 저장소 쓰기도 없다. */
  const loadChart = useCallback(async (target: BirthInput) => {
    setChartError(null);
    try {
      const response = await fetch(apiUrl("/api/chart"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await requestHeaders()) },
        body: JSON.stringify({ birth: target }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "명식을 계산하지 못했어요.");
      setChartSummary(data.chart as ChartSummary);
    } catch (error) {
      setChartError(error instanceof Error ? error.message : "명식을 계산하지 못했어요.");
    }
  }, []);

  function selectTab(next: Tab) {
    setTab(next);
    if (next === "archive" && auth && !auth.isAnonymous && savedList === null) void loadArchive();
    if (next === "chart" && birth.date && chartSummary === null) void loadChart(birth);
  }

  /** 보관함에서 구글 연동만 먼저 하는 경로. */
  async function linkFromArchive() {
    const linked = await linkGoogleAccount();
    if (!linked.ok) return;
    setAuth(await currentAuthState());
    void loadArchive();
  }

  /**
   * 이 이야기를 오래 보관한다.
   *
   * 익명 상태면 먼저 구글 연동을 띄운다. **연동은 익명 uid 를 승격시키는 것**이라
   * 방금 만든 이 세션이 그대로 내 것으로 남는다 — 새로 로그인하는 게 아니다.
   */
  async function saveReading() {
    if (!session || saveState === "working" || saveState === "saved") return;
    setSaveState("working");

    if (!auth || auth.isAnonymous) {
      const linked = await linkGoogleAccount();
      if (!linked.ok) {
        // 사용자가 팝업을 닫은 것은 실패가 아니다. 원래 자리로 돌려놓는다.
        setSaveState(linked.reason === "cancelled" ? "idle" : "failed");
        return;
      }
      setAuth(await currentAuthState());
    }

    try {
      const response = await fetch(apiUrl("/api/reading/saved"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await requestHeaders()) },
        body: JSON.stringify({ sessionId: session.sessionId }),
      });
      setSaveState(response.ok ? "saved" : "failed");
      // 보관함을 열었을 때 방금 저장한 것이 빠져 있으면 안 된다.
      if (response.ok) setSavedList(null);
    } catch {
      setSaveState("failed");
    }
  }

  return (
    <div className={`app-shell stage-${stage}`}>
      <div className="ambient" aria-hidden="true"><span /><span /><span /></div>
      <header className="topbar">
        <Brand />
        {step > 0 && (
          <div className="progress-wrap" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={Math.min(step, 3)} aria-label={`진행 단계 ${Math.min(step, 3)} / 3`}>
            <span className="progress-label">{stage === "reading" ? "당신이 고른 길" : `${String(Math.min(step, 3)).padStart(2, "0")} / 03`}</span>
            <div className="progress-track"><i style={{ width: `${Math.min(step, 3) / 3 * 100}%` }} /></div>
          </div>
        )}
        {/*
          데스크톱 전용 탭. 하단 바는 모바일에서만 뜨므로, 이게 없으면
          내 사주·보관함에 **아예 도달할 수 없다**(실제로 그렇게 나갔다).
        */}
        <div className="topbar-actions">
          <nav className="top-nav" aria-label="주요 화면">
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-current={tab === item.key ? "page" : undefined}
                onClick={() => selectTab(item.key)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <button className="icon-button" type="button" onClick={openInfo} aria-label="서비스 안내"><span>?</span></button>
        </div>
      </header>

      {tab === "story" && stage === "landing" && (
        <main className="landing" ref={mainRef} tabIndex={-1}>
          <div className="hero-copy">
            <p className="eyebrow"><span />아직 정리 안 된 그 선택</p>
            <h1>그때 그 선택,<br />아직도 후회되나요.</h1>
            <p className="hero-description">가지 않은 길이 더 나았을 거라는 생각, 혼자서는 정리되지 않습니다.<br className="desktop-only" /> 그 길에도 치를 대가가 있었다는 걸 당신의 사주로 보여드립니다.</p>
            <div className="brand-definition">
              <strong>만약사주란?</strong>
              <p>미래를 점치지 않습니다. 대신 당신이 고르지 않은 길에서 무엇을 얻고 무엇을 잃었을지 3년치로 보여드립니다. 후회가 옅어지는 건 그다음입니다.</p>
            </div>
            <button className="primary-button hero-button" type="button" onClick={() => setStage("birth")}>
              그 길 끝을 확인하기 <Arrow />
            </button>
            <p className="microcopy"><LockIcon /> 이름과 연락처는 받지 않으며, 입력은 7일 뒤 사라집니다.</p>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="orbit orbit-one" /><div className="orbit orbit-two" />
            <div className={`hero-card card-back back-left ${cardVariant(0)}`}><CardArtwork slot={0} /></div>
            <div className={`hero-card card-back back-center ${cardVariant(1)}`}><CardArtwork slot={1} /></div>
            <div className={`hero-card card-back back-right ${cardVariant(2)}`}><CardArtwork slot={2} /></div>
            <span className="star star-one">✦</span><span className="star star-two">·</span><span className="star star-three">✧</span>
          </div>
          <div className="how-it-works" aria-label="이용 순서">
            <span><b>01</b> 그때 이야기를 씁니다</span><i /><span><b>02</b> 딱 한 장만 엽니다</span><i /><span><b>03</b> 그 길의 대가를 봅니다</span>
          </div>
        </main>
      )}

      {tab === "story" && stage === "birth" && (
        <main className="form-page" ref={mainRef} tabIndex={-1}>
          <button className="back-button" type="button" onClick={() => setStage("landing")}><Arrow direction="left" /> 돌아가기</button>
          <section className="form-heading">
            <p className="eyebrow"><span />01 그때 이야기를 씁니다</p>
            <h1>태어난 순간을<br />알려주세요.</h1>
            <p>같은 선택이라도 사람마다 치르는 대가가 다릅니다. 그 차이를 가르는 게 이 정보예요.</p>
          </section>
          <form className="input-card" onSubmit={submitBirth}>
            <div className="field-grid two-columns">
              <div className="birth-date-group">
                <div className="field">
                  <div className="birth-date-label">
                    <label htmlFor="birth-date">생년월일</label>
                    <div className="calendar-toggle" role="radiogroup" aria-label="달력 기준">
                      {CALENDAR_TYPES.map(({ value, label }) => (
                        <label key={value}>
                          <input
                            type="radio"
                            name="calendar-type"
                            value={value}
                            checked={birth.calendarType === value}
                            onChange={() => setBirth((current) => ({
                              ...current,
                              calendarType: value,
                              lunarLeapMonth: value === "lunar" ? current.lunarLeapMonth : false,
                            }))}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <input
                    id="birth-date"
                    required
                    type="date"
                    value={birth.date}
                    max={birth.calendarType === "solar" ? new Date().toISOString().slice(0, 10) : undefined}
                    onChange={(eventObject) => setBirth((current) => ({ ...current, date: eventObject.target.value }))}
                  />
                </div>
                {birth.calendarType === "lunar" ? (
                  <label className="check-row lunar-leap-row">
                    <input
                      type="checkbox"
                      checked={birth.lunarLeapMonth}
                      onChange={(eventObject) => setBirth((current) => ({ ...current, lunarLeapMonth: eventObject.target.checked }))}
                    />
                    <span className="checkmark" />
                    <span>윤달이에요</span>
                  </label>
                ) : null}
              </div>
              <label className="field"><span>태어난 시각</span><input required={!birth.timeUnknown} disabled={birth.timeUnknown} type="time" value={birth.time} onChange={(e) => setBirth({ ...birth, time: e.target.value })} /></label>
            </div>
            <label className="check-row"><input type="checkbox" checked={birth.timeUnknown} onChange={(e) => setBirth({ ...birth, timeUnknown: e.target.checked, time: e.target.checked ? "" : birth.time })} /><span className="checkmark" /><span>태어난 시각을 몰라요</span></label>
            <div className="field-grid two-columns">
              <div className="field">
                <label className="field-label" htmlFor="birth-city">출생 도시</label>
                <select
                  id="birth-city"
                  value={birthCitySelection}
                  onChange={(eventObject) => setBirth((current) => ({
                    ...current,
                    city: eventObject.target.value === OTHER_BIRTH_CITY ? "" : eventObject.target.value,
                  }))}
                >
                  {BIRTH_CITIES.map((city) => <option key={city} value={city}>{city}</option>)}
                  <option value={OTHER_BIRTH_CITY}>기타 (직접 입력)</option>
                </select>
                {birthCitySelection === OTHER_BIRTH_CITY ? (
                  <input
                    aria-label="출생 도시 직접 입력"
                    required
                    type="text"
                    value={birth.city}
                    placeholder="예: 수원, 춘천"
                    maxLength={80}
                    onChange={(eventObject) => setBirth((current) => ({ ...current, city: eventObject.target.value }))}
                  />
                ) : null}
                <small>목록 밖 도시는 한반도 평균 경도로 보정하고 이 브라우저에만 기억해요.</small>
              </div>
              <label className="field"><span>성별</span><select value={birth.gender} onChange={(e) => setBirth({ ...birth, gender: e.target.value as BirthInput["gender"] })}><option>응답 안 함</option><option>여성</option><option>남성</option></select><small>대운의 흐름 계산에만 사용해요.</small></label>
            </div>
            <div className="form-footer"><span className="privacy-note"><LockIcon /> 브라우저에 안전하게 기억해 둘게요.</span><button className="primary-button" type="submit">다음 <Arrow /></button></div>
          </form>
        </main>
      )}

      {tab === "story" && stage === "event" && (
        <main className="form-page event-page" ref={mainRef} tabIndex={-1}>
          <button className="back-button" type="button" onClick={() => setStage("birth")}><Arrow direction="left" /> 출생 정보</button>
          <section className="form-heading compact-heading">
            <p className="eyebrow"><span />01 그때 이야기를 씁니다</p>
            <h1>아직도 생각나는<br />그 선택은 뭔가요?</h1>
            <p>잘 쓴 글이 아니어도 괜찮아요. 적어 주신 표현이 결과 문장에 그대로 인용됩니다.</p>
          </section>
          <form className="input-card wide-card" onSubmit={prepareCards}>
            <fieldset className="category-field"><legend>어떤 일이었나요?</legend><div className="category-grid">{CATEGORIES.map(({ label, glyph }) => <button key={label} type="button" aria-pressed={event.category === label} onClick={() => setEvent({ ...event, category: label })}><b>{glyph}</b><span>{label}</span></button>)}</div></fieldset>
            <p className="category-helper">{EXAMPLES[event.category].helper}</p>
            <label className="field month-field"><span>사건이 있었던 때</span><input required type="month" value={event.date} max={new Date().toISOString().slice(0, 7)} onChange={(e) => setEvent({ ...event, date: e.target.value })} /></label>
            {showExample && <ExampleHint guide={EXAMPLES[event.category]} onDismiss={() => { setShowExample(false); localStorage.setItem("ifsaju-example-seen", "yes"); }} />}
            <label className="field story-field"><span>그때의 이야기를 들려주세요 <em>필수</em></span><textarea required minLength={10} maxLength={600} value={event.story} placeholder={EXAMPLES[event.category].placeholder} onChange={(e) => setEvent({ ...event, story: e.target.value })} /><small className={event.story.length > 560 ? "limit" : ""}>{event.story.length} / 600</small></label>
            <button className="optional-toggle" type="button" aria-expanded={showOptional} onClick={() => setShowOptional((value) => !value)}><span>조금 더 들려주기 <small>선택</small></span><b>{showOptional ? "−" : "+"}</b></button>
            {showOptional && <div className="optional-fields"><label className="field"><span>실제로는 어떻게 되었나요?</span><small className="field-hint">실제로 고른 길이 무엇인지 알아야 &lsquo;가지 않은 길&rsquo;을 반대 방향으로 잡습니다.</small><textarea maxLength={400} value={event.outcome} placeholder={`예: ${EXAMPLES[event.category].sample.outcome}`} onChange={(e) => setEvent({ ...event, outcome: e.target.value })} /></label><label className="field"><span>다른 길을 생각해 본 적 있나요?</span><small className="field-hint">아쉬움이 남는 쪽을 적어 주시면 그 방향으로 이야기를 풉니다.</small><textarea maxLength={400} value={event.alternative} placeholder={`예: ${EXAMPLES[event.category].sample.alternative}`} onChange={(e) => setEvent({ ...event, alternative: e.target.value })} /></label></div>}
            <div className="slider-group"><h2>그때의 마음은 어땠나요?</h2><p>정확하지 않아도 괜찮아요. <b>지금 돌아본 느낌</b>으로 고르시면 됩니다. 세 값이 카드 세 장을 고르는 데 함께 쓰여요.</p><SliderField label="준비도" hint="그 선택을 감당할 준비가 얼마나 되어 있었나요? (돈·경험·주변 지원)" low="전혀 준비되지 않음" high="충분히 준비됨" value={context.readiness} onChange={(value) => setContext({ ...context, readiness: value })} /><SliderField label="선택의 자유" hint="다른 길을 고를 여지가 실제로 있었나요? 이미 정해진 상황이었나요?" low="선택지가 거의 없음" high="내 뜻대로 가능" value={context.freedom} onChange={(value) => setContext({ ...context, freedom: value })} /><SliderField label="상실의 두려움" hint="그 선택으로 잃을까 봐 두려웠던 것이 얼마나 컸나요?" low="크지 않았음" high="매우 컸음" value={context.fear} onChange={(value) => setContext({ ...context, fear: value })} /></div>
            {error && <div className="error-panel" role="alert"><strong>{error.message}</strong>{error.support && <span>{error.support}</span>}</div>}
            <div className="form-footer event-footer"><span className="privacy-note"><LockIcon /> 선택지는 서버에서 봉인됩니다.</span><button className="primary-button" type="submit" disabled={isPreparing || event.story.trim().length < 10 || !event.date}>{isPreparing ? <><span className="spinner" /> 세 길을 봉인하는 중</> : <>세 개의 길 만나기 <Arrow /></>}</button></div>
          </form>
        </main>
      )}

      {tab === "story" && stage === "cards" && session && (
        <main className="cards-page" ref={mainRef} tabIndex={-1}>
          <p className="eyebrow centered"><span />02 딱 한 장만 엽니다</p>
          <h1>마음이 가는 한 장을<br />골라주세요.</h1>
          <p className="cards-intro"><b>한 장을 열면 나머지 둘은 영영 닫힙니다. 그때처럼요.</b><br />생각보다 먼저 닿는 쪽을 선택해 보세요.</p>
          <div className="sealed-cards" role="group" aria-label="봉인된 카드 세 장">
            {CARD_SLOTS.map((slot) => <button className={`sealed-card card-back ${cardVariant(slot)}`} key={slot} type="button" onClick={(eventObject) => previewCard(slot, eventObject)} aria-label={`${slot + 1}번째 봉인 카드 선택`}><span className="card-number">0{slot + 1}</span><CardArtwork slot={slot} /><span className="card-prompt">이 길을 열어보기</span></button>)}
          </div>
          <p className="seal-note"><span className={sealVerified ? "seal-dot verified" : "seal-dot"} /> {sealVerified ? "세 장은 선택 전에 봉인되었습니다" : "봉인을 확인하고 있습니다"}</p>
          <button className="text-button" type="button" onClick={() => setStage("event")}><Arrow direction="left" /> 이야기를 조금 고칠래요</button>
        </main>
      )}

      {tab === "story" && stage === "reading" && (
        <main className="reading-page" ref={mainRef} tabIndex={-1}>
          <section className={`reveal-hero ${reveal ? "is-revealed" : ""}`}>
            <div className={`selected-stack ${cardVariant(selectedSlot ?? reveal?.slot ?? 0)}`} aria-hidden="true"><span /><span /><div className="selected-card"><CardArtwork slot={selectedSlot ?? reveal?.slot ?? 0} /></div></div>
            <div className="reveal-copy">
              <p className="eyebrow"><span />당신이 고른 길</p>
              {reveal ? <><div className="axis-chip">{reveal.choiceAxis}의 흐름</div><h1>{reveal.title}</h1><p className="choice-quote">“{reveal.choiceText}”</p><span className="verified-label"><LockIcon open /> {sealVerified ? "선택 전 봉인과 일치해요" : "봉인을 확인하는 중이에요"}</span></> : <><div className="streaming-kicker"><span className="spinner" /> 봉인을 여는 중</div><h1 className="ghost-title">선택한 길이<br />모습을 드러냅니다.</h1></>}
            </div>
          </section>

          <div className="reading-content" aria-live="polite" aria-busy={isStreaming}>
            {overview.length > 0 && <section className="reading-section fade-in"><p className="section-number">01</p><div><h2>그 길의 시작</h2>{overview.map((paragraph, index) => <p className="reading-paragraph" key={index}>{paragraph}</p>)}</div></section>}
            {timeline.length > 0 && <section className="reading-section timeline-section fade-in"><p className="section-number">02</p><div><h2>시간이 흐른 뒤</h2><div className="timeline">{timeline.map((item, index) => <article key={index} className={`timeline-item tone-${item.tone}`}><div className="timeline-marker"><span>{item.month}</span><small>개월째</small></div><div><p className="timeline-label">{item.label}</p><p>{item.text}</p></div></article>)}</div></div></section>}
            {balance && <section className="reading-section fade-in"><p className="section-number">03</p><div><h2>얻게 되는 것과<br />놓치게 되는 것</h2><div className="balance-grid"><article><p className="balance-label gain"><span>＋</span> 얻게 되는 것</p><ul>{balance.gains.map((item) => <li key={item}>{item}</li>)}</ul></article><article><p className="balance-label loss"><span>−</span> 놓치게 되는 것</p><ul>{balance.losses.map((item) => <li key={item}>{item}</li>)}</ul></article></div></div></section>}
            {commonFate && <section className="fate-section fade-in"><span className="fate-orbit" aria-hidden="true"><i /><i /></span><p className="eyebrow centered"><span />어느 길에도 남는 것</p><blockquote>{commonFate}</blockquote></section>}
            {basis && <section className="basis-section fade-in"><details><summary><span><b>왜 이런 결과가 나왔나요?</b><small>계산에 사용된 사주 근거 보기</small></span><i>＋</i></summary><div className="basis-content"><ul><li><span>사주 원국</span><p><strong>{basis.pillars}</strong></p></li><li><span>일간</span><p><strong>{basis.dayMaster}</strong>, {basis.strength}</p></li><li><span>대운</span><p>{basis.daeun}</p></li><li><span>용신·기신</span><p>{basis.usefulFlow}</p></li><li><span>사건 흐름</span><p>{basis.eventFlow}</p></li>{basis.turningPointsUsed.map((point) => <li key={point.monthOffset}><span>{point.monthOffset}개월째</span><p>{point.label}이 전환점으로 계산되었어요.</p></li>)}<li><span>현실 조건</span><p>{basis.realityContext}</p></li><li><span>출생 시각</span><p>{basis.hourPillarNote}</p></li></ul><p className="engine-note">계산 규칙 {basis.engineVersion}</p></div></details></section>}
            {isStreaming && <div className="writing-status" aria-live="polite"><span className="writing-line" /><span>운명의 다음 문장을 기록하고 있어요</span></div>}
            {error && <div className="error-panel reading-error" role="alert"><strong>{error.message}</strong></div>}
            {closing && <section className="closing-section fade-in"><p>{closing.closingLine}</p><span className="closing-symbol" aria-hidden="true"><i /><i /></span><div className="feedback-box"><h2>이 이야기는 어떻게 느껴졌나요?</h2><p>당신의 답은 사주가 이야기에 실제로 기여하는지 확인하는 데 쓰여요.</p><div>{[{ key: "plausible", label: "꽤 그럴듯해요" }, { key: "uncertain", label: "잘 모르겠어요" }, { key: "not-really", label: "별로 그렇지 않아요" }].map((item) => <button type="button" key={item.key} aria-pressed={feedback === item.key} className={feedback === item.key ? "selected" : ""} disabled={Boolean(feedback)} onClick={() => sendFeedback(item.key)}>{feedback === item.key ? "✓ " : ""}{item.label}</button>)}</div>{feedback && <span className="thanks">고마워요. 답을 안전하게 기록했어요.</span>}</div><SaveBox state={saveState} linked={Boolean(auth && !auth.isAnonymous)} onSave={saveReading} /><p className="uncertainty">{closing.uncertaintyNote}</p><button className="secondary-button" type="button" onClick={resetEvent}>다른 갈림길 열어보기 <Arrow /></button></section>}
          </div>
        </main>
      )}

      {/*
        푸터는 **이야기 탭에만** 둔다. 탭 화면들은 이 아래에 렌더되므로,
        가드가 없으면 푸터가 내 사주·보관함 위에 뜬다(실제로 그렇게 나갔다).
        모바일에서는 CSS 로 숨긴다 — 같은 내용이 「더보기」 하단에 있다.
      */}
      {tab === "story" && (
        <footer className="footer"><span>© 2026 만약사주</span><button type="button" onClick={openInfo}>이용 안내</button><Link href="/privacy">개인정보처리방침</Link><Link href="/terms">이용약관</Link><span>첫 번째 이야기 · 가지 않은 운</span></footer>
      )}

      {ageGate === "checking" && <div className="modal-layer age-layer age-checking" aria-label="연령 확인 준비 중"><span className="spinner" /></div>}

      {candidate !== null && <div className="modal-layer" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setCandidate(null); }}><section ref={decisionRef} tabIndex={-1} className="decision-sheet" style={{ "--sheet-x": `${sheetOrigin.x}px`, "--sheet-y": `${sheetOrigin.y}px` } as CSSProperties} role="dialog" aria-modal="true" aria-labelledby="decision-title"><span className="sheet-handle" /><div className={`mini-card card-back ${cardVariant(candidate)}`}><CardArtwork slot={candidate} /></div><p className="eyebrow centered"><span />마지막 확인</p><h2 id="decision-title">이 카드를 열까요?</h2><p>선택하면 다른 두 장은 열리지 않습니다.<br />고른 카드는 끝까지 바뀌지 않아요.</p><button data-autofocus className="primary-button full-button" type="button" onClick={openCard}>이 길을 열어볼게요 <Arrow /></button><button className="sheet-cancel" type="button" onClick={() => setCandidate(null)}>조금 더 생각할게요</button></section></div>}

      {(ageGate === "open" || ageGate === "blocked") && <div className="modal-layer age-layer"><section ref={ageRef} tabIndex={-1} className="age-gate" role="dialog" aria-modal="true" aria-labelledby="age-title"><span className="age-symbol" aria-hidden="true">十四</span>{ageGate === "open" ? <><p className="eyebrow centered"><span />시작하기 전에</p><h2 id="age-title">만 14세 이상인가요?</h2><p>생년월일과 과거의 이야기를 다루는 서비스예요.<br />만 14세 미만에게는 제공하지 않습니다.</p><button data-autofocus className="primary-button full-button" type="button" onClick={acceptAge}>네, 만 14세 이상이에요</button><button className="sheet-cancel" type="button" onClick={() => setAgeGate("blocked")}>만 14세 미만이에요</button></> : <><h2 id="age-title">지금은 이용할 수 없어요.</h2><p>소중한 정보를 안전하게 지키기 위해 만 14세 이상부터 이용할 수 있습니다.</p></>}</section></div>}

      {showInfo && (
        <div className="modal-layer" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowInfo(false); }}>
          <section ref={infoRef} tabIndex={-1} className="info-sheet" role="dialog" aria-modal="true" aria-labelledby="info-title">
            <button data-autofocus className="close-button" type="button" aria-label="닫기" onClick={() => setShowInfo(false)}>×</button>
            <p className="eyebrow"><span />알아두세요</p>
            <h2 id="info-title">예언이 아닌,<br />지나간 선택의 성찰입니다.</h2>
            <div className="brand-story">
              <span>이름에 담은 뜻</span>
              <p><strong>만약사주</strong>는 과거를 맞히거나 바꾸는 서비스가 아닙니다. 가지 않은 길이 더 나았을 거라는 생각은 혼자서는 정리되지 않습니다. 그 길에도 치를 대가가 있었다는 걸 사주로 보여드려, 지금의 선택을 다시 보게 하는 경험입니다.</p>
            </div>
            <p>결과는 명리 규칙을 결정론적으로 적용해 만든 반사실 서사이며, 실제로 일어났을 일을 주장하지 않습니다.</p>
            <dl>
              <div><dt>수집 정보</dt><dd>생년월일시, 성별, 과거 사건과 선택</dd></div>
              <div><dt>보관</dt><dd>서버 세션은 7일 뒤 이용이 차단되고 자동 삭제 대상으로 전환, 출생 정보 캐시는 이 브라우저에만 저장</dd></div>
              <div><dt>사용하지 않는 것</dt><dd>이름, 연락처, 정확한 주소</dd></div>
            </dl>
            <p className="legal-links"><Link href="/privacy">개인정보처리방침 전문</Link> · <Link href="/terms">이용약관 전문</Link></p>
            <p className="support-note">죽음·폭력·심각한 사고처럼 마음을 크게 다치게 한 사건은 자동 해석하지 않습니다. 위기 시 자살예방상담 109, 정신건강 위기상담 1577-0199에 연락하세요.</p>
            <button className="secondary-button full-button" type="button" onClick={() => setShowInfo(false)}>확인했어요</button>
          </section>
        </div>
      )}

      {tab === "chart" && (
        <ChartScreen
          chart={chartSummary}
          error={chartError}
          hasBirth={Boolean(birth.date)}
          onGoBirth={() => { setTab("story"); setStage("birth"); }}
          onRetry={() => loadChart(birth)}
        />
      )}

      {tab === "archive" && !IS_TOSS_APP && (
        <ArchiveScreen
          items={savedList}
          error={savedError}
          linked={Boolean(auth && !auth.isAnonymous)}
          onLink={linkFromArchive}
          onRetry={loadArchive}
          onOpen={(item) => {
            if (item.slot === null) return;
            setTab("story");
            // 보관함에서 여는 것이므로 원본 커밋먼트 목록이 없다.
            // 해시 자체 검증은 그대로 하고 교차 검증만 생략한다.
            void streamReading(item.id, item.slot);
          }}
        />
      )}

      {tab === "more" && (
        <main className="tab-page">
          <p className="eyebrow"><span />더보기</p>
          <h1>내 정보</h1>
          <div className="more-card">
            <strong>계정</strong>
            {IS_TOSS_APP
              // 토스 안에서는 연결할 방법이 없다. 없는 걸 권하지 않는다.
              ? <span>토스로 열었을 때는 계정 연결 없이 바로 쓰실 수 있어요. 대신 읽은 이야기는 7일 뒤 사라집니다.</span>
              : auth && !auth.isAnonymous
                ? <span>{auth.name ? `${auth.name} 님으로 연결됨` : "구글 계정으로 연결됨"}. 보관한 이야기를 어느 기기에서나 볼 수 있어요.</span>
                : <span>지금은 연결하지 않은 상태예요. 연결하면 보관한 이야기를 기기를 바꿔도 볼 수 있습니다.</span>}
            {!IS_TOSS_APP && (!auth || auth.isAnonymous) && (
              <button className="secondary-button" type="button" onClick={linkFromArchive}>구글 계정 연결하기</button>
            )}
          </div>
          <div className="more-card">
            <strong>입력 예시</strong>
            <span>처음 쓸 때 보이던 예시를 다시 켤 수 있어요.</span>
            <button
              className="secondary-button"
              type="button"
              onClick={() => { localStorage.removeItem("ifsaju-example-seen"); setShowExample(true); setTab("story"); }}
            >
              예시 다시 보기
            </button>
          </div>
          <div className="more-card">
            <strong>보관 기간</strong>
            <span>보관하지 않은 기록은 <b>7일</b> 뒤 자동으로 지워집니다. 보관을 선택한 기록은 <b>1년</b>간 남습니다.</span>
          </div>
          <p className="legal-links"><Link href="/privacy">개인정보처리방침</Link> · <Link href="/terms">이용약관</Link></p>
          <p className="support-note">죽음·폭력·심각한 사고처럼 마음을 크게 다치게 한 사건은 자동 해석하지 않습니다. 위기 시 자살예방상담 109, 정신건강 위기상담 1577-0199에 연락하세요.</p>
          {/*
            맨 아래 작게. 읽으라고 두는 게 아니라, 문제를 알릴 때 어느 버전
            이야기인지 짚을 수 있게 두는 값이다.
          */}
          {APP_VERSION && <p className="app-version">버전 {APP_VERSION}{IS_TOSS_APP ? " · 토스" : ""}</p>}
        </main>
      )}

      <BottomNav current={tab} onSelect={selectTab} />
    </div>
  );
}
