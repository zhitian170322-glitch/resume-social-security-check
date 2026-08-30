import type { Metadata } from "next";
import { Suspense } from "react";
import { AppChrome } from "@/components/app-chrome";
import "./globals.css";

export const metadata: Metadata = {
  title: "简历与社保严格核验",
  description: "以社保缴纳记录为事实依据，逐段对照简历工作经历并计算定薪有效社保年限",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <Suspense fallback={<div className="app-window" />}>
          <AppChrome>{children}</AppChrome>
        </Suspense>
      </body>
    </html>
  );
}
