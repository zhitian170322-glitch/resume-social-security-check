"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

export const APP_NAVIGATION = [
  { href: "/", label: "工作台" },
  { href: "/#new-verification", label: "新建核查" },
  { href: "/history", label: "核查记录" },
  { href: "/history?review=1", label: "待人工复核" },
] as const;

export const APP_SUBTITLE = "简历与社保严格核验";

function pageTitle(pathname: string, reviewOnly: boolean) {
  if (pathname.startsWith("/result/")) return "核验结果";
  if (pathname.startsWith("/processing/")) return "任务处理";
  if (pathname === "/history") return reviewOnly ? "待人工复核" : "核查记录";
  return "核查工作台";
}

export function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const reviewOnly = searchParams.get("review") === "1";
  return (
    <div className="app-window">
      <aside className="mac-sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark">核</span>
          <div>
            <strong>社保核查</strong>
            <small>{APP_SUBTITLE}</small>
          </div>
        </div>
        <nav className="sidebar-nav" aria-label="主导航">
          {APP_NAVIGATION.map((item) => {
            const active =
              item.href === "/history?review=1"
                ? pathname === "/history" && reviewOnly
                : item.href === "/history"
                  ? pathname === "/history" && !reviewOnly
                  : item.href === "/"
                    ? pathname === "/"
                    : false;
            return (
              <Link className={active ? "selected" : ""} href={item.href} key={item.label}>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <p>{APP_SUBTITLE}</p>
        </div>
      </aside>
      <div className="app-stage">
        <header className="mac-toolbar">
          <strong>{pageTitle(pathname, reviewOnly)}</strong>
        </header>
        <div className="app-scroll">{children}</div>
      </div>
    </div>
  );
}
