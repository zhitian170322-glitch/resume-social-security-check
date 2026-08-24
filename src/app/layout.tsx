import type { Metadata } from "next";
import { AppChrome } from "@/components/app-chrome";
import "./globals.css";

export const metadata: Metadata = {
  title: "简历与社保智能核验",
  description: "以社保缴纳记录为基准，核验候选人简历工作经历",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><AppChrome>{children}</AppChrome></body>
    </html>
  );
}
