"use client";

import { FormEvent, type CSSProperties, type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import type { BirthInput, EventCategory, ReadingInput, ReadingResult, TenGodAxis } from "@/lib/reading-types";

type Stage = "landing" | "birth" | "event" | "cards" | "reading";
type SessionEnvelope = {
  sessionId: string;
  choiceCommitments: string[];
  sessionCommitment: string;
};
type Reveal = {
  slot: number;
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

const EXAMPLES: Record<EventCategory, { helper: string; placeholder: string }> = {
  이직: { helper: "예: 안정적인 회사를 떠날지 고민했던 순간", placeholder: "그때 어떤 선택 앞에 서 있었나요? 당시 상황과 실제로 고른 길을 들려주세요." },
  이사: { helper: "예: 익숙한 도시를 떠날 기회가 왔던 순간", placeholder: "어디로, 왜 옮길지 고민했나요? 마음에 남은 갈림길을 적어주세요." },
  연애: { helper: "예: 관계를 이어갈지 멈출지 고민했던 순간", placeholder: "그 관계에서 어떤 선택을 했고, 무엇이 가장 마음에 남았나요?" },
  진학: { helper: "예: 원하는 전공과 현실적인 선택 사이", placeholder: "당시 어떤 두 길 사이에서 고민했는지 적어주세요." },
  창업: { helper: "예: 제안을 받아들일지 안정에 남을지", placeholder: "그 기회와 망설임, 실제 선택을 구체적으로 들려주세요." },
  투자: { helper: "예: 큰 결정을 앞두고 주저했던 순간", placeholder: "어떤 조건과 두려움이 선택에 영향을 주었나요?" },
  가족: { helper: "예: 가족을 위해 내 계획을 바꿨던 순간", placeholder: "누구의 잘잘못보다, 당시 내가 놓인 선택을 중심으로 적어주세요." },
  기타: { helper: "오래 마음에 남아 있는 한 번의 갈림길", placeholder: "그때 무엇을 선택했고, 고르지 않은 길은 무엇이었나요?" },
};

const EMPTY_BIRTH: BirthInput = { date: "", time: "", timeUnknown: false, city: "서울", gender: "응답 안 함" };
const EMPTY_EVENT: ReadingInput["event"] = { category: "이직", date: "", story: "", outcome: "", alternative: "" };
const EMPTY_CONTEXT: ReadingInput["context"] = { readiness: 3, freedom: 3, fear: 3 };

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
    <button className="brand" type="button" aria-label="처음으로" onClick={() => window.location.reload()}>
      <span className="brand-mark" aria-hidden="true"><i /><i /></span>
      <span>가지 않은 운</span>
    </button>
  );
}

function SliderField({ label, low, high, value, onChange }: { label: string; low: string; high: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="slider-field">
      <span className="slider-title"><span>{label}</span><output>{value}</output></span>
      <input type="range" min="1" max="5" step="1" value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <span className="slider-ends"><span>{low}</span><span>{high}</span></span>
    </label>
  );
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function PastSajuExperience() {
  const [stage, setStage] = useState<Stage>("landing");
  const [ageGate, setAgeGate] = useState<"checking" | "open" | "accepted" | "blocked">("checking");
  const [birth, setBirth] = useState<BirthInput>(EMPTY_BIRTH);
  const [event, setEvent] = useState<ReadingInput["event"]>(EMPTY_EVENT);
  const [context, setContext] = useState(EMPTY_CONTEXT);
  const [showOptional, setShowOptional] = useState(false);
  const [session, setSession] = useState<SessionEnvelope | null>(null);
  const [candidate, setCandidate] = useState<number | null>(null);
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

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const accepted = localStorage.getItem("past-saju-age-confirmed") === "yes";
      setAgeGate(accepted ? "accepted" : "open");
      const cached = localStorage.getItem("past-saju-birth");
      if (cached) {
        try { setBirth({ ...EMPTY_BIRTH, ...JSON.parse(cached) }); } catch { /* ignore invalid local cache */ }
      }
      const cachedReading = localStorage.getItem("past-saju-last-reading");
      if (cachedReading) {
        try {
          const reading = JSON.parse(cachedReading) as CachedReading;
          if (Date.now() - reading.savedAt < 7 * 24 * 60 * 60 * 1000) {
            setSession(reading.session);
            setReveal(reading.reveal);
            setOverview(reading.overview);
            setTimeline(reading.timeline);
            setBalance(reading.balance);
            setCommonFate(reading.commonFate);
            setBasis(reading.basis);
            setClosing(reading.closing);
            setSealVerified(true);
            setStage("reading");
          } else localStorage.removeItem("past-saju-last-reading");
        } catch { localStorage.removeItem("past-saju-last-reading"); }
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
    localStorage.setItem("past-saju-last-reading", JSON.stringify(cached));
  }, [balance, basis, closing, commonFate, overview, reveal, session, timeline]);

  const step = stage === "birth" ? 1 : stage === "event" ? 2 : stage === "cards" ? 3 : stage === "reading" ? 4 : 0;
  const input = useMemo<ReadingInput>(() => ({ birth, event, context }), [birth, event, context]);

  function acceptAge() {
    localStorage.setItem("past-saju-age-confirmed", "yes");
    setAgeGate("accepted");
  }

  function openInfo(eventObject: ReactMouseEvent<HTMLButtonElement>) {
    openerRef.current = eventObject.currentTarget;
    setShowInfo(true);
  }

  function previewCard(slot: number, eventObject: ReactMouseEvent<HTMLButtonElement>) {
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
    if (!birth.date || (!birth.timeUnknown && !birth.time) || !birth.city) return;
    localStorage.setItem("past-saju-birth", JSON.stringify(birth));
    setStage("event");
  }

  async function prepareCards(eventObject: FormEvent) {
    eventObject.preventDefault();
    if (!event.date || event.story.trim().length < 10) return;
    setIsPreparing(true);
    setError(null);
    try {
      const response = await fetch("/api/reading/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await response.json();
      if (!response.ok) {
        setError({ message: data.message ?? "봉인을 준비하지 못했어요.", support: data.support });
        return;
      }
      setSession(data);
      const recomputed = await sha256([...data.choiceCommitments].sort().join("|"));
      setSealVerified(recomputed === data.sessionCommitment);
      setStage("cards");
    } catch {
      setError({ message: "연결이 잠시 불안정해요. 입력은 그대로 두었으니 다시 시도해 주세요." });
    } finally {
      setIsPreparing(false);
    }
  }

  async function openCard() {
    if (candidate === null || !session || isStreaming) return;
    const slot = candidate;
    setCandidate(null);
    setStage("reading");
    setIsStreaming(true);
    setError(null);
    try {
      const response = await fetch("/api/reading/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.sessionId, slot }),
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
            setSealVerified(verified === chunk.data.commitment && session.choiceCommitments[slot] === chunk.data.commitment);
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
    localStorage.removeItem("past-saju-last-reading");
    setEvent(EMPTY_EVENT);
    setContext(EMPTY_CONTEXT);
    setSession(null);
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
    await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: session.sessionId, value }) });
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
        <button className="icon-button" type="button" onClick={openInfo} aria-label="서비스 안내"><span>?</span></button>
      </header>

      {stage === "landing" && (
        <main className="landing" ref={mainRef} tabIndex={-1}>
          <div className="hero-copy">
            <p className="eyebrow"><span />사주 결정형 반사실 서사</p>
            <h1>그때, 다른 길을<br />걸었다면.</h1>
            <p className="hero-description">미래를 점치는 대신, 지나간 운명의 갈림길을 다시 엽니다.<br className="desktop-only" /> 당신의 사주가 고른 세 개의 길 중 하나를 만나보세요.</p>
            <button className="primary-button hero-button" type="button" onClick={() => setStage("birth")}>
              지나간 갈림길 열기 <Arrow />
            </button>
            <p className="microcopy"><LockIcon /> 이름과 연락처는 받지 않으며, 입력은 7일 뒤 사라집니다.</p>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="orbit orbit-one" /><div className="orbit orbit-two" />
            <div className="hero-card card-back back-left"><span className="card-sigil"><i /><i /><b /></span></div>
            <div className="hero-card card-back back-center"><span className="card-sigil"><i /><i /><b /></span></div>
            <div className="hero-card card-back back-right"><span className="card-sigil"><i /><i /><b /></span></div>
            <span className="star star-one">✦</span><span className="star star-two">·</span><span className="star star-three">✧</span>
          </div>
          <div className="how-it-works" aria-label="이용 순서">
            <span><b>01</b> 갈림길을 들려주세요</span><i /><span><b>02</b> 봉인된 한 장을 고르세요</span><i /><span><b>03</b> 가지 않은 3년을 읽어요</span>
          </div>
        </main>
      )}

      {stage === "birth" && (
        <main className="form-page" ref={mainRef} tabIndex={-1}>
          <button className="back-button" type="button" onClick={() => setStage("landing")}><Arrow direction="left" /> 돌아가기</button>
          <section className="form-heading">
            <p className="eyebrow"><span />첫 번째 기록</p>
            <h1>태어난 순간을<br />알려주세요.</h1>
            <p>이 정보는 이야기의 시점과 흐름을 계산하는 데만 쓰입니다.</p>
          </section>
          <form className="input-card" onSubmit={submitBirth}>
            <div className="field-grid two-columns">
              <label className="field"><span>생년월일</span><input required type="date" value={birth.date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBirth({ ...birth, date: e.target.value })} /></label>
              <label className="field"><span>태어난 시각</span><input required={!birth.timeUnknown} disabled={birth.timeUnknown} type="time" value={birth.time} onChange={(e) => setBirth({ ...birth, time: e.target.value })} /></label>
            </div>
            <label className="check-row"><input type="checkbox" checked={birth.timeUnknown} onChange={(e) => setBirth({ ...birth, timeUnknown: e.target.checked, time: e.target.checked ? "" : birth.time })} /><span className="checkmark" /><span>태어난 시각을 몰라요</span></label>
            <div className="field-grid two-columns">
              <label className="field"><span>출생 도시</span><select value={birth.city} onChange={(e) => setBirth({ ...birth, city: e.target.value })}>{["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "제주", "강릉", "전주"].map((city) => <option key={city}>{city}</option>)}</select><small>경도 보정 후 도시 정보는 저장하지 않아요.</small></label>
              <label className="field"><span>성별</span><select value={birth.gender} onChange={(e) => setBirth({ ...birth, gender: e.target.value as BirthInput["gender"] })}><option>응답 안 함</option><option>여성</option><option>남성</option></select><small>대운의 흐름 계산에만 사용해요.</small></label>
            </div>
            <div className="form-footer"><span className="privacy-note"><LockIcon /> 브라우저에 안전하게 기억해 둘게요.</span><button className="primary-button" type="submit">다음 <Arrow /></button></div>
          </form>
        </main>
      )}

      {stage === "event" && (
        <main className="form-page event-page" ref={mainRef} tabIndex={-1}>
          <button className="back-button" type="button" onClick={() => setStage("birth")}><Arrow direction="left" /> 출생 정보</button>
          <section className="form-heading compact-heading">
            <p className="eyebrow"><span />두 번째 기록</p>
            <h1>마음에 남은<br />갈림길은 언제였나요?</h1>
            <p>잘 쓴 글이 아니어도 괜찮아요. 그때의 상황만 솔직하게 들려주세요.</p>
          </section>
          <form className="input-card wide-card" onSubmit={prepareCards}>
            <fieldset className="category-field"><legend>어떤 일이었나요?</legend><div className="category-grid">{CATEGORIES.map(({ label, glyph }) => <button key={label} type="button" aria-pressed={event.category === label} onClick={() => setEvent({ ...event, category: label })}><b>{glyph}</b><span>{label}</span></button>)}</div></fieldset>
            <p className="category-helper">{EXAMPLES[event.category].helper}</p>
            <label className="field month-field"><span>사건이 있었던 때</span><input required type="month" value={event.date} max={new Date().toISOString().slice(0, 7)} onChange={(e) => setEvent({ ...event, date: e.target.value })} /></label>
            <label className="field story-field"><span>그때의 이야기를 들려주세요 <em>필수</em></span><textarea required minLength={10} maxLength={600} value={event.story} placeholder={EXAMPLES[event.category].placeholder} onChange={(e) => setEvent({ ...event, story: e.target.value })} /><small className={event.story.length > 560 ? "limit" : ""}>{event.story.length} / 600</small></label>
            <button className="optional-toggle" type="button" aria-expanded={showOptional} onClick={() => setShowOptional((value) => !value)}><span>조금 더 들려주기 <small>선택</small></span><b>{showOptional ? "−" : "+"}</b></button>
            {showOptional && <div className="optional-fields"><label className="field"><span>실제로는 어떻게 되었나요?</span><textarea maxLength={400} value={event.outcome} onChange={(e) => setEvent({ ...event, outcome: e.target.value })} /></label><label className="field"><span>다른 길을 생각해 본 적 있나요?</span><textarea maxLength={400} value={event.alternative} onChange={(e) => setEvent({ ...event, alternative: e.target.value })} /></label></div>}
            <div className="slider-group"><h2>그때의 마음은 어땠나요?</h2><p>정확하지 않아도 괜찮아요. 직감에 가까운 곳을 골라주세요.</p><SliderField label="준비도" low="전혀 준비되지 않음" high="충분히 준비됨" value={context.readiness} onChange={(value) => setContext({ ...context, readiness: value })} /><SliderField label="선택의 자유" low="선택지가 거의 없음" high="내 뜻대로 가능" value={context.freedom} onChange={(value) => setContext({ ...context, freedom: value })} /><SliderField label="상실의 두려움" low="크지 않았음" high="매우 컸음" value={context.fear} onChange={(value) => setContext({ ...context, fear: value })} /></div>
            {error && <div className="error-panel" role="alert"><strong>{error.message}</strong>{error.support && <span>{error.support}</span>}</div>}
            <div className="form-footer event-footer"><span className="privacy-note"><LockIcon /> 선택지는 서버에서 봉인됩니다.</span><button className="primary-button" type="submit" disabled={isPreparing || event.story.trim().length < 10 || !event.date}>{isPreparing ? <><span className="spinner" /> 세 길을 봉인하는 중</> : <>세 개의 길 만나기 <Arrow /></>}</button></div>
          </form>
        </main>
      )}

      {stage === "cards" && session && (
        <main className="cards-page" ref={mainRef} tabIndex={-1}>
          <p className="eyebrow centered"><span />세 갈래의 가능성</p>
          <h1>마음이 가는 한 장을<br />골라주세요.</h1>
          <p className="cards-intro">각 카드에는 사주가 고른 서로 다른 길이 봉인되어 있습니다.<br />생각보다 먼저 닿는 쪽을 선택해 보세요.</p>
          <div className="sealed-cards" role="group" aria-label="봉인된 카드 세 장">
            {[0, 1, 2].map((slot) => <button className="sealed-card card-back" key={slot} type="button" onClick={(eventObject) => previewCard(slot, eventObject)} aria-label={`${slot + 1}번째 봉인 카드 선택`}><span className="card-number">0{slot + 1}</span><span className="card-sigil"><i /><i /><b /></span><span className="card-prompt">이 길을 열어보기</span></button>)}
          </div>
          <p className="seal-note"><span className={sealVerified ? "seal-dot verified" : "seal-dot"} /> {sealVerified ? "세 장은 선택 전에 봉인되었습니다" : "봉인을 확인하고 있습니다"}</p>
          <button className="text-button" type="button" onClick={() => setStage("event")}><Arrow direction="left" /> 이야기를 조금 고칠래요</button>
        </main>
      )}

      {stage === "reading" && (
        <main className="reading-page" ref={mainRef} tabIndex={-1}>
          <section className={`reveal-hero ${reveal ? "is-revealed" : ""}`}>
            <div className="selected-stack" aria-hidden="true"><span /><span /><div className="selected-card"><span className="card-sigil"><i /><i /><b /></span></div></div>
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
            {closing && <section className="closing-section fade-in"><p>{closing.closingLine}</p><span className="closing-symbol" aria-hidden="true"><i /><i /></span><div className="feedback-box"><h2>이 이야기는 어떻게 느껴졌나요?</h2><p>당신의 답은 사주가 이야기에 실제로 기여하는지 확인하는 데 쓰여요.</p><div>{[{ key: "plausible", label: "꽤 그럴듯해요" }, { key: "uncertain", label: "잘 모르겠어요" }, { key: "not-really", label: "별로 그렇지 않아요" }].map((item) => <button type="button" key={item.key} aria-pressed={feedback === item.key} className={feedback === item.key ? "selected" : ""} disabled={Boolean(feedback)} onClick={() => sendFeedback(item.key)}>{feedback === item.key ? "✓ " : ""}{item.label}</button>)}</div>{feedback && <span className="thanks">고마워요. 답을 안전하게 기록했어요.</span>}</div><p className="uncertainty">{closing.uncertaintyNote}</p><button className="secondary-button" type="button" onClick={resetEvent}>다른 갈림길 열어보기 <Arrow /></button></section>}
          </div>
        </main>
      )}

      <footer className="footer"><span>© 2026 가지 않은 운</span><button type="button" onClick={openInfo}>이용 안내 · 개인정보</button><span>오락과 성찰을 위한 서비스</span></footer>

      {ageGate === "checking" && <div className="modal-layer age-layer age-checking" aria-label="연령 확인 준비 중"><span className="spinner" /></div>}

      {candidate !== null && <div className="modal-layer" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setCandidate(null); }}><section ref={decisionRef} tabIndex={-1} className="decision-sheet" style={{ "--sheet-x": `${sheetOrigin.x}px`, "--sheet-y": `${sheetOrigin.y}px` } as CSSProperties} role="dialog" aria-modal="true" aria-labelledby="decision-title"><span className="sheet-handle" /><div className="mini-card card-back"><span className="card-sigil"><i /><i /><b /></span></div><p className="eyebrow centered"><span />마지막 확인</p><h2 id="decision-title">이 카드를 열까요?</h2><p>선택하면 다른 두 장은 열리지 않습니다.<br />고른 카드는 끝까지 바뀌지 않아요.</p><button data-autofocus className="primary-button full-button" type="button" onClick={openCard}>이 길을 열어볼게요 <Arrow /></button><button className="sheet-cancel" type="button" onClick={() => setCandidate(null)}>조금 더 생각할게요</button></section></div>}

      {(ageGate === "open" || ageGate === "blocked") && <div className="modal-layer age-layer"><section ref={ageRef} tabIndex={-1} className="age-gate" role="dialog" aria-modal="true" aria-labelledby="age-title"><span className="age-symbol" aria-hidden="true">十四</span>{ageGate === "open" ? <><p className="eyebrow centered"><span />시작하기 전에</p><h2 id="age-title">만 14세 이상인가요?</h2><p>생년월일과 과거의 이야기를 다루는 서비스예요.<br />만 14세 미만에게는 제공하지 않습니다.</p><button data-autofocus className="primary-button full-button" type="button" onClick={acceptAge}>네, 만 14세 이상이에요</button><button className="sheet-cancel" type="button" onClick={() => setAgeGate("blocked")}>만 14세 미만이에요</button></> : <><h2 id="age-title">지금은 이용할 수 없어요.</h2><p>소중한 정보를 안전하게 지키기 위해 만 14세 이상부터 이용할 수 있습니다.</p></>}</section></div>}

      {showInfo && <div className="modal-layer" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowInfo(false); }}><section ref={infoRef} tabIndex={-1} className="info-sheet" role="dialog" aria-modal="true" aria-labelledby="info-title"><button data-autofocus className="close-button" type="button" aria-label="닫기" onClick={() => setShowInfo(false)}>×</button><p className="eyebrow"><span />알아두세요</p><h2 id="info-title">예언이 아닌,<br />지나간 선택의 성찰입니다.</h2><p>결과는 명리 규칙을 결정론적으로 적용해 만든 반사실 서사이며, 실제로 일어났을 일을 주장하지 않습니다.</p><dl><div><dt>수집 정보</dt><dd>생년월일시, 성별, 과거 사건과 선택</dd></div><div><dt>보관</dt><dd>서버 세션은 최대 7일, 출생 정보 캐시는 이 브라우저에만 저장</dd></div><div><dt>사용하지 않는 것</dt><dd>이름, 연락처, 정확한 주소</dd></div></dl><p className="support-note">죽음·폭력·심각한 사고처럼 마음을 크게 다치게 한 사건은 자동 해석하지 않습니다. 위기 시 자살예방상담 109, 정신건강 위기상담 1577-0199에 연락하세요.</p><button className="secondary-button full-button" type="button" onClick={() => setShowInfo(false)}>확인했어요</button></section></div>}
    </div>
  );
}
