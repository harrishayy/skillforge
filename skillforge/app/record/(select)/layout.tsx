"use client";
import Link from "next/link";

export default function SelectLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ backgroundColor: "var(--sf-white)", color: "var(--sf-black)" }}>
      <nav
        className="shrink-0 flex items-center px-6 py-3 border-b"
        style={{ backgroundColor: "var(--sf-black)", borderColor: "#222" }}
      >
        <Link
          href="/"
          className="text-base font-black tracking-tight"
          style={{ color: "var(--sf-white)", letterSpacing: "-0.04em" }}
        >
          SkillForge
        </Link>
      </nav>
      <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
    </div>
  );
}
