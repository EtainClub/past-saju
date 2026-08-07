import { ImageResponse } from "next/og";

export const socialImageSize = {
  width: 1200,
  height: 630,
};

const cardOffsets = [
  { transform: "rotate(-7deg) translateY(16px)", opacity: 0.84, colors: ["#765058", "#51353b", "#ebcfc2"] },
  { transform: "translateY(-8px)", opacity: 1, colors: ["#704149", "#472931", "#efd9c2"] },
  { transform: "rotate(7deg) translateY(16px)", opacity: 0.84, colors: ["#65505d", "#41333f", "#e3cbd5"] },
];

function BrandMark() {
  return (
    <div
      style={{
        width: 54,
        height: 54,
        border: "1.5px solid rgba(32,32,30,.55)",
        borderRadius: 999,
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
            width: 1.5,
            height: 34,
            position: "absolute",
            background: "rgba(32,32,30,.55)",
            transform: `rotate(${rotation}deg)`,
          }}
        />
      ))}
      <div style={{ width: 7, height: 7, borderRadius: 999, background: "#713e43" }} />
    </div>
  );
}

function SocialCardSigil({ index, color }: { index: number; color: string }) {
  const common = { fill: "none", stroke: color, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (index === 0) {
    return <svg width="76" height="76" viewBox="0 0 100 100"><circle {...common} cx="50" cy="50" r="31" opacity=".56" /><circle {...common} cx="50" cy="50" r="22" opacity=".28" /><path {...common} d="M50 20v30M50 50 31 72M50 50l19 22" opacity=".82" /><path {...common} d="M24 50h52" opacity=".25" /><circle cx="50" cy="50" r="4" fill="#f5dfbd" /></svg>;
  }
  if (index === 1) {
    return <svg width="76" height="76" viewBox="0 0 100 100"><circle {...common} cx="50" cy="50" r="27" opacity=".56" /><ellipse {...common} cx="50" cy="50" rx="37" ry="14" transform="rotate(-28 50 50)" opacity=".82" /><ellipse {...common} cx="50" cy="50" rx="37" ry="14" transform="rotate(28 50 50)" opacity=".28" /><path {...common} d="M50 18v64" opacity=".25" /><circle cx="50" cy="50" r="4" fill="#f5dfbd" /></svg>;
  }
  return <svg width="76" height="76" viewBox="0 0 100 100"><path {...common} d="m50 18 30 32-30 32-30-32Z" opacity=".56" /><circle {...common} cx="50" cy="50" r="23" opacity=".28" /><path {...common} d="M28 50c10-19 34-19 44 0-10 19-34 19-44 0Z" opacity=".82" /><path {...common} d="M50 21v58M25 50h50" opacity=".25" /><circle cx="50" cy="50" r="4" fill="#f5dfbd" /></svg>;
}

function SealedCard({ transform, opacity, colors, index }: { transform: string; opacity: number; colors: string[]; index: number }) {
  const [base, deep, ink] = colors;
  return (
    <div
      style={{
        width: 126,
        height: 190,
        borderRadius: 13,
        position: "relative",
        background: `linear-gradient(155deg, ${base}, ${deep})`,
        border: "1px solid rgba(245,222,204,.34)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,.06), 0 24px 50px rgba(46,27,31,.24)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transform,
        opacity,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 9,
          border: `1px solid ${ink}77`,
          borderRadius: 8,
          boxShadow: `inset 0 0 0 4px ${deep}, inset 0 0 0 5px ${ink}32`,
          display: "flex",
        }}
      />
      <div style={{ position: "absolute", top: 18, left: 19, color: ink, fontSize: 11, letterSpacing: ".12em", opacity: .62, display: "flex" }}>0{index + 1}</div>
      <SocialCardSigil index={index} color={ink} />
      <div style={{ position: "absolute", bottom: 17, color: ink, fontSize: 8, fontWeight: 600, letterSpacing: ".2em", opacity: .62, display: "flex" }}>만약사주</div>
    </div>
  );
}

export function createSocialImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          background: "#f6f3ed",
          color: "#20201e",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 520,
            height: 520,
            borderRadius: 999,
            top: -265,
            right: -80,
            background: "rgba(113,62,67,.07)",
          }}
        />
        <div
          style={{
            position: "absolute",
            width: 350,
            height: 350,
            borderRadius: 999,
            bottom: -245,
            left: 130,
            border: "1px solid rgba(113,62,67,.13)",
          }}
        />

        <div
          style={{
            width: "58%",
            padding: "70px 0 64px 78px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 17 }}>
            <BrandMark />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.04em" }}>만약사주</div>
              <div style={{ fontSize: 15, color: "#77736b", letterSpacing: "0.08em" }}>가지 않은 운</div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 24, color: "#713e43", fontSize: 17, fontWeight: 700, letterSpacing: "0.12em" }}>
              <div style={{ width: 38, height: 1, background: "#713e43" }} />
              지나온 선택으로 읽는 사주
            </div>
            <div style={{ display: "flex", flexDirection: "column", fontSize: 68, lineHeight: 1.16, fontWeight: 700, letterSpacing: "-0.055em" }}>
              <div>그때, 다른 길을</div>
              <div>걸었다면.</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", marginTop: 25, color: "#77736b", fontSize: 21, lineHeight: 1.55 }}>
              <div>세 개의 길 중 하나를 열어</div>
              <div>가지 않은 3년을 읽습니다.</div>
            </div>
          </div>
        </div>

        <div
          style={{
            width: "42%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            paddingRight: 54,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {cardOffsets.map((card, index) => <SealedCard key={index} {...card} index={index} />)}
          </div>
        </div>

        <div style={{ position: "absolute", left: 78, right: 78, bottom: 37, height: 1, background: "rgba(43,41,37,.11)" }} />
      </div>
    ),
    socialImageSize,
  );
}
