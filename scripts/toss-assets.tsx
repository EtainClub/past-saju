import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ImageResponse } from "next/og";

/**
 * 앱인토스 심사용 로고 생성.
 *
 * 브랜드 마크는 `src/app/icon.svg` 와 같은 도형이다 — 원, 세 획, 중심점.
 * 세 획은 갈림길을, 중심점은 고른 하나를 뜻한다. 파비콘·OG 이미지와 같은
 * 마크를 써야 앱 목록에서 같은 서비스로 보인다.
 *
 * 스크린샷은 여기서 만들지 않는다. **실제 화면을 캡처**하는 것이 맞다 —
 * 그리는 순간 실물과 달라지고, 심사와 사용자 기대가 어긋난다.
 *
 * 사용: node .test-dist/scripts/toss-assets.js
 */

// 저장소 루트에서 실행한다. __dirname 은 컴파일 산출 위치에 따라 달라져
// 경로가 어긋난다 — 실제로 그렇게 한 번 틀렸다.
const OUT = resolve(process.cwd(), "public/appintoss");
const SIZE = 600;

const WINE = "#713e43";
const PAPER = "#f6f3ed";
const INK = "#20201e";

/** 원 + 세 획 + 중심점. 획 색만 바꾸면 라이트·다크에 모두 쓴다. */
function Mark({ ring, stroke, dot }: { ring: string; stroke: string; dot: string }) {
  const circle = SIZE * 0.62;
  const strokeWidth = SIZE * 0.016;
  return (
    <div
      style={{
        width: circle,
        height: circle,
        borderRadius: 999,
        border: `${SIZE * 0.012}px solid ${ring}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
      }}
    >
      {[0, 60, -60].map((rotation) => (
        <div
          key={rotation}
          style={{
            position: "absolute",
            width: strokeWidth,
            height: circle * 0.78,
            background: stroke,
            borderRadius: strokeWidth,
            transform: `rotate(${rotation}deg)`,
          }}
        />
      ))}
      <div style={{ width: SIZE * 0.075, height: SIZE * 0.075, borderRadius: 999, background: dot }} />
    </div>
  );
}

function logo(mode: "light" | "dark") {
  const background = mode === "light" ? PAPER : "#1c1a18";
  const ring = mode === "light" ? "rgba(32,32,30,.5)" : "rgba(246,243,237,.42)";
  const stroke = mode === "light" ? INK : "#efe9df";
  return (
    <div
      style={{
        width: SIZE,
        height: SIZE,
        background,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Mark ring={ring} stroke={stroke} dot={mode === "light" ? WINE : "#d09aa0"} />
    </div>
  );
}

async function write(name: string, element: React.ReactElement, width: number, height: number) {
  const response = new ImageResponse(element, { width, height });
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(resolve(OUT, name), buffer);
  console.log(`  ${name.padEnd(28)} ${width}×${height}  ${(buffer.length / 1024).toFixed(0)}KB`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log("앱인토스 로고 생성 → public/appintoss/\n");
  await write("app-logo-light-600.png", logo("light"), SIZE, SIZE);
  await write("app-logo-dark-600.png", logo("dark"), SIZE, SIZE);
  console.log("\n스크린샷은 실제 화면을 캡처한다 — scripts/toss-screenshots.mjs");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
