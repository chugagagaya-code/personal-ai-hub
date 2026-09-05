import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "个人人工智能中心",
  description: "个人记忆智能体工作区",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
