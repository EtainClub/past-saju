/**
 * 운영 지표 조회 — 배포가 "됐는지"가 아니라 "도는지"를 본다.
 *
 * 배포는 성공했는데 LLM 경로가 한 번도 안 도는 상황이 가장 위험하다.
 * 오류가 아니라 조용한 폴백이라 로그에도 안 남는다.
 *
 * 사용: node scripts/prod-metrics.cjs
 *   ADC 필요 — gcloud auth application-default login
 */
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp({ credential: applicationDefault(), projectId: "pastsaju" });
const db = getFirestore();

const GROUPS = [
  ["L2 갈림길 분류", /^fork/],
  ["L5 렌더링", /^render/],
  ["기타", /.*/],
];

async function main() {
  const day = new Date().toISOString().slice(0, 10);

  const phaseZero = await db.collection("internalMetrics").doc("phase-zero").get();
  const budget = await db.collection("internalMetrics").doc("llmBudget").get();
  const usage = await db.collection("internalMetrics").doc(`llmUsage-${day}`).get();

  console.log(`=== internalMetrics/phase-zero ===`);
  const data = phaseZero.data() ?? {};
  const keys = Object.keys(data).sort();
  if (!keys.length) {
    console.log("  (비어 있음 — 아직 아무 경로도 안 돌았다)");
  } else {
    const shown = new Set();
    for (const [label, pattern] of GROUPS) {
      const matched = keys.filter((key) => !shown.has(key) && pattern.test(key));
      if (!matched.length) continue;
      console.log(`\n  [${label}]`);
      for (const key of matched) {
        shown.add(key);
        console.log(`    ${key.padEnd(34)} ${data[key]}`);
      }
    }
  }

  console.log(`\n=== 일일 호출 예산 ===`);
  const b = budget.data();
  console.log(b ? `  ${b.day}  ${b.calls}회 사용` : "  (아직 호출 없음)");

  console.log(`\n=== 토큰 사용량 (${day}) ===`);
  const u = usage.data();
  if (!u) {
    console.log("  (아직 없음)");
  } else {
    for (const layer of ["l2", "l5"]) {
      const calls = u[`${layer}_calls`] ?? 0;
      if (!calls) continue;
      console.log(
        `  ${layer.toUpperCase()}  ${calls}회  입력 ${u[`${layer}_input`] ?? 0}`
        + `  출력 ${u[`${layer}_output`] ?? 0}`
        + `  캐시쓰기 ${u[`${layer}_cacheWrite`] ?? 0}  캐시읽기 ${u[`${layer}_cacheRead`] ?? 0}`,
      );
    }
  }

  // 폴백률 — A4 도입 의미가 살아 있는지 판정하는 값.
  const attempt = data.renderAttempt ?? 0;
  const success = data.renderSucceeded ?? 0;
  if (attempt) {
    const rate = ((attempt - success) / attempt) * 100;
    console.log(`\n=== 렌더 폴백률 ===`);
    console.log(`  시도 ${attempt} · 성공 ${success} · 폴백 ${(attempt - success)} (${rate.toFixed(1)}%)`);
    console.log(`  목표 < 5%. 표본이 작으면 의미 없다.`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
