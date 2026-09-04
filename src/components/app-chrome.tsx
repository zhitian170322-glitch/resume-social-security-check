"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export const APP_NAVIGATION = [
  { href: "/", label: "工作台" },
  { href: "/#new-verification", label: "新建核查" },
  { href: "/history", label: "核查记录" },
] as const;

export const APP_SUBTITLE = "简历与社保严格核验";

function pageTitle(pathname: string) {
  if (pathname.startsWith("/result/")) return "核验结果";
  if (pathname.startsWith("/processing/")) return "任务处理";
  if (pathname === "/history") return "核查记录";
  return "核查工作台";
}

export function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
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
              item.href === "/history"
                ? pathname === "/history"
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
          <strong>{pageTitle(pathname)}</strong>
        </header>
        <div className="app-scroll">{children}</div>
      </div>
    </div>
  );
}
