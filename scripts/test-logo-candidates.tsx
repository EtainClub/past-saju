import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ImageResponse } from "next/og";

const OUT = resolve(process.cwd(), "scratch/logo-candidates");
const SIZE = 600;

// Color tokens
const WINE = "#713e43";
const WINE_DARK = "#d09aa0";
const PAPER = "#f6f3ed";
const PAPER_DARK = "#151514";
const INK = "#20201e";
const INK_DARK = "#f6f3ed";

/**
 * Supreme Harmonic Fork (수학적 조화와 황금비율의 만약사주 로고)
 */
function SupremeHarmonicFork({ mode }: { mode: "light" | "dark" }) {
  const bg = mode === "light" ? PAPER : PAPER_DARK;
  const stroke = mode === "light" ? INK : INK_DARK;
  const strokeSub = mode === "light" ? "rgba(32,32,30,0.68)" : "rgba(246,243,237,0.68)";
  const ring = mode === "light" ? "rgba(32,32,30,0.34)" : "rgba(246,243,237,0.34)";
  const ringFaint = mode === "light" ? "rgba(32,32,30,0.12)" : "rgba(246,243,237,0.12)";
  const seal = mode === "light" ? WINE : WINE_DARK;
  const sealHalo = mode === "light" ? "rgba(113,62,67,0.14)" : "rgba(208,154,160,0.14)";

  // Geometry calculations (Centered at 50, 50)
  // Branch radius R = 35
  // Angles from top: 0 deg (center), -38 deg (left), +38 deg (right)
  // cos(38 deg) ≈ 0.788, sin(38 deg) ≈ 0.6157
  // Left: dx = -35 * 0.6157 = -21.55 => x = 28.45, dy = -35 * 0.788 = -27.58 => y = 22.42
  // Right: x = 71.55, y = 22.42
  // Center: x = 50, y = 15

  return (
    <div
      style={{
        width: SIZE,
        height: SIZE,
        background: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg width={SIZE * 0.78} height={SIZE * 0.78} viewBox="0 0 100 100" fill="none">
        {/* Outer Circular Boundary */}
        <circle cx="50" cy="50" r="45" stroke={ring} strokeWidth="1.5" />
        
        {/* 4 Cardinal Marks (사주팔자 4주: 연월일시 상징) */}
        <line x1="50" y1="3" x2="50" y2="6.5" stroke={ring} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="50" y1="93.5" x2="50" y2="97" stroke={ring} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="3" y1="50" x2="6.5" y2="50" stroke={ring} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="93.5" y1="50" x2="97" y2="50" stroke={ring} strokeWidth="1.5" strokeLinecap="round" />

        {/* Celestial Orbit Circles */}
        <circle cx="50" cy="50" r="35" stroke={ringFaint} strokeWidth="0.75" />
        <circle cx="50" cy="50" r="23" stroke={ringFaint} strokeWidth="0.75" strokeDasharray="1.5 2.5" />

        {/* Subtle Horizontal Meridian */}
        <line x1="16" y1="50" x2="84" y2="50" stroke={ringFaint} strokeWidth="0.6" strokeDasharray="2 3" />

        {/* Past Root Path (시간의 시작 / 지나온 길) */}
        <line x1="50" y1="85" x2="50" y2="50" stroke={stroke} strokeWidth="2.8" strokeLinecap="round" />

        {/* Future Path 1: Chosen Path (수직의 중심 길) */}
        <line x1="50" y1="50" x2="50" y2="15" stroke={stroke} strokeWidth="2.8" strokeLinecap="round" />

        {/* Future Path 2: Left Branch (가지 않은 길 1) */}
        <path
          d="M 50 50 C 49 36, 38 29, 23.5 22.4"
          stroke={strokeSub}
          strokeWidth="2.4"
          strokeLinecap="round"
        />

        {/* Future Path 3: Right Branch (가지 않은 길 2) */}
        <path
          d="M 50 50 C 51 36, 62 29, 76.5 22.4"
          stroke={strokeSub}
          strokeWidth="2.4"
          strokeLinecap="round"
        />

        {/* Terminal Destiny Nodes (선택지에 맺히는 운명의 결실) */}
        <circle cx="23.5" cy="22.4" r="2.8" fill={seal} />
        <circle cx="50" cy="15" r="3.2" fill={seal} />
        <circle cx="76.5" cy="22.4" r="2.8" fill={seal} />
        <circle cx="50" cy="85" r="2" fill={stroke} />

        {/* Center Turning Point / Crimson Seal (선택의 갈림길 중심 인장) */}
        <circle cx="50" cy="50" r="10" fill={sealHalo} />
        <circle cx="50" cy="50" r="7" fill={mode === "light" ? "#fbf9f5" : "#191817"} stroke={seal} strokeWidth="1.5" />
        <circle cx="50" cy="50" r="4.2" fill={seal} />
      </svg>
    </div>
  );
}

async function write(name: string, element: React.ReactElement) {
  const response = new ImageResponse(element, { width: SIZE, height: SIZE });
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(resolve(OUT, name), buffer);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await write("supreme-light.png", <SupremeHarmonicFork mode="light" />);
  await write("supreme-dark.png", <SupremeHarmonicFork mode="dark" />);
  console.log("Supreme Harmonic Fork rendered!");
}

main().catch(console.error);
