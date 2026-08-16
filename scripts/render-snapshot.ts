import { createHash } from "node:crypto";
import { createReadingSession } from "../src/lib/reading-engine";
import { classifyFork } from "../src/lib/fork/classify";
import type { EventCategory, ReadingInput } from "../src/lib/reading-types";

/**
 * 렌더링 출력 스냅샷.
 *
 * A3(템플릿 이관)는 동작 무변경 리팩터다. 이관 전후로 이 해시가 같아야 한다.
 * 세션 id·nonce·commitment는 난수이므로 제외하고, 결정론적인 result만 본다.
 * 카드 슬롯 배치도 난수이므로 축으로 정렬한다.
 */

const CATEGORIES: EventCategory[] = ["이직", "이사", "연애", "진학", "창업", "투자", "가족", "기타"];
const OUTCOMES = ["", "결국 퇴사했습니다.", "결국 남았습니다.", "결국 헤어졌습니다.", "대학원에 진학했습니다."];
const CITIES = ["서울", "부산", "대구", "제주", "기타"];

function build(index: number): ReadingInput {
  const year = 1955 + (index * 7) % 60;
  const month = ((index * 5) % 12) + 1;
  const day = ((index * 11) % 27) + 1;
  const hour = (index * 3) % 24;
  return {
    birth: {
      date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      calendarType: index % 7 === 0 ? "lunar" : "solar",
      lunarLeapMonth: false,
      time: index % 11 === 0 ? "" : `${String(hour).padStart(2, "0")}:${String((index * 13) % 60).padStart(2, "0")}`,
      timeUnknown: index % 11 === 0,
      city: CITIES[index % CITIES.length],
      gender: index % 3 === 0 ? "남성" : index % 3 === 1 ? "여성" : "응답 안 함",
    },
    event: {
      category: CATEGORIES[index % CATEGORIES.length],
      date: `${2015 + (index % 9)}-${String(((index * 3) % 12) + 1).padStart(2, "0")}`,
      story: `${index}번째 갈림길에서 오래 고민했습니다. 그때의 선택이 지금도 남아 있습니다.`,
      outcome: OUTCOMES[index % OUTCOMES.length],
      alternative: index % 4 === 0 ? "그때 다른 길을 골랐다면 어땠을까 생각합니다." : "",
    },
    context: {
      readiness: (index % 5) + 1,
      freedom: ((index * 2) % 5) + 1,
      fear: ((index * 3) % 5) + 1,
    },
  };
}

const cases = Array.from({ length: 60 }, (_, index) => index).map((index) => {
  const input = build(index);
  // fork를 명시적으로 넘겨 패턴 분류까지 스냅샷에 고정한다(LLM 호출 없음).
  const session = createReadingSession(input, classifyFork(input));
  return session.choices
    .map((choice) => ({ axis: choice.axis, title: choice.title, text: choice.text, spec: choice.narrativeSpec, result: choice.result }))
    .sort((a, b) => a.axis.localeCompare(b.axis));
});

const digest = createHash("sha256").update(JSON.stringify(cases)).digest("hex");
console.log(`render snapshot: 60 cases, sha256=${digest}`);

if (process.argv[2] && process.argv[2] !== digest) {
  console.error(`\n스냅샷 불일치!\n  기대: ${process.argv[2]}\n  실제: ${digest}`);
  process.exit(1);
}
if (process.argv[2]) console.log("일치 — 출력이 바뀌지 않았습니다.");
