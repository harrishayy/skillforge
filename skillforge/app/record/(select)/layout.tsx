"use client";
import Link from "next/link";

export default function SelectLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "var(--sf-white)", color: "var(--sf-black)" }}>
      <nav
        className="flex items-center px-6 py-3 border-b"
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
      {children}
    </div>
  );
}
