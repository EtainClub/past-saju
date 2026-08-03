import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://ifsaju.com"),
  title: "만약사주 — 가지 않은 운",
  description: "“그때 다른 길을 골랐다면?” 지나온 선택을 통해 지금의 나를 이해하는 사주 경험. 사주가 고른 세 개의 길 중 하나를 열어 가지 않은 3년을 읽습니다.",
  applicationName: "만약사주",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "만약사주",
    url: "/",
    locale: "ko_KR",
    title: "만약사주 — 가지 않은 운",
    description: "“그때 다른 길을 골랐다면?” 사주가 고른 세 개의 길 중 하나를 열어 가지 않은 3년을 읽습니다.",
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
