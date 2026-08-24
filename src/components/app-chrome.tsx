"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const navigation = [
  { href: "/", label: "工作台", icon: "⌂" },
  { href: "/#new-verification", label: "新建核查", icon: "+" },
  { href: "/history", label: "核查记录", icon: "≡" },
] as const;

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
            <small>Evidence Workspace</small>
          </div>
        </div>
        <nav className="sidebar-nav" aria-label="主导航">
          {navigation.map((item) => {
            const active =
              item.href === "/history"
                ? pathname === "/history"
                : item.href === "/"
                  ? pathname === "/"
                  : false;
            return (
              <Link className={active ? "selected" : ""} href={item.href} key={item.label}>
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
          <button disabled><span aria-hidden="true">◎</span>待人工复核</button>
          <button disabled><span aria-hidden="true">⌕</span>搜索</button>
        </nav>
        <div className="sidebar-footer">
          <button disabled><span aria-hidden="true">⚙</span>设置</button>
          <p>准确率优先 · 证据可追溯</p>
        </div>
      </aside>
      <div className="app-stage">
        <header className="mac-toolbar">
          <div className="traffic-lights" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <strong>{pageTitle(pathname)}</strong>
          <div className="toolbar-actions">
            <button aria-label="搜索" disabled>⌕</button>
            <button aria-label="通知" disabled>◌</button>
            <span className="user-chip" aria-label="内部工具">HR</span>
          </div>
        </header>
        <div className="app-scroll">{children}</div>
      </div>
    </div>
  );
}
