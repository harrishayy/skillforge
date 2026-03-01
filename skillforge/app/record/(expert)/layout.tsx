"use client";
import Link from "next/link";

export default function RecordExpertLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ backgroundColor: "var(--sf-white)", color: "var(--sf-black)" }}>
      <nav
        className="shrink-0 flex items-center gap-6 px-6 py-3 border-b"
        style={{ backgroundColor: "var(--sf-black)", borderColor: "#222" }}
      >
        <Link
          href="/"
          className="text-base font-black tracking-tight"
          style={{ color: "var(--sf-white)", letterSpacing: "-0.04em" }}
        >
          SkillForge
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link
            href="/record"
            className="font-medium transition-colors"
            style={{ color: "#aaa" }}
            onMouseEnter={e => (e.currentTarget.style.color = "var(--sf-purple)")}
            onMouseLeave={e => (e.currentTarget.style.color = "#aaa")}
          >
            Record
          </Link>
          <Link
            href="/workflows"
            className="font-medium transition-colors"
            style={{ color: "#aaa" }}
            onMouseEnter={e => (e.currentTarget.style.color = "var(--sf-purple)")}
            onMouseLeave={e => (e.currentTarget.style.color = "#aaa")}
          >
            My Workflows
          </Link>
        </div>
        <div className="ml-auto">
          <span
            className="text-xs font-bold px-3 py-1 rounded-full"
            style={{ backgroundColor: "var(--sf-purple)", color: "var(--sf-black)" }}
          >
            Expert Mode
          </span>
        </div>
      </nav>
      <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
    </div>
  );
}
