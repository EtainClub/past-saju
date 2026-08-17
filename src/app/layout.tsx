import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://ifsaju.com"),
  title: "만약사주 — 가지 않은 운",
  description: "그때 그 선택, 아직도 후회되나요? 가지 않은 길에도 대가가 있었습니다. 당신의 사주로 그 3년을 읽어드립니다.",
  applicationName: "만약사주",
  alternates: { canonical: "/" },
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    siteName: "만약사주",
    url: "/",
    locale: "ko_KR",
    title: "만약사주 — 가지 않은 운",
    description: "그때 그 선택, 아직도 후회되나요? 가지 않은 길에도 대가가 있었습니다.",
  },
  twitter: {
    card: "summary_large_image",
    title: "만약사주 — 가지 않은 운",
    description: "그때 그 선택, 아직도 후회되나요? 가지 않은 길에도 대가가 있었습니다.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f3ed" },
    { media: "(prefers-color-scheme: dark)", color: "#151514" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
