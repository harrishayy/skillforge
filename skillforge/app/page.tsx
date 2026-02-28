"use client";
import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--sf-white)", color: "var(--sf-black)" }}>

      {/* NAV */}
      <nav
        className="flex items-center justify-between px-8 py-4 border-b"
        style={{ backgroundColor: "var(--sf-black)", borderColor: "var(--sf-black)" }}
      >
        <span className="text-xl font-black tracking-tight" style={{ color: "var(--sf-white)", letterSpacing: "-0.04em" }}>
          SkillForge
        </span>
        <div
          className="text-xs font-bold px-3 py-1 rounded-full"
          style={{ backgroundColor: "var(--sf-purple)", color: "var(--sf-black)" }}
        >
          BUILD AI FESTIVAL 2026
        </div>
      </nav>

      {/* HERO */}
      <section
        className="px-8 pt-20 pb-16 border-b"
        style={{ backgroundColor: "var(--sf-black)", borderColor: "#222" }}
      >
        <div className="max-w-5xl mx-auto">
          {/* Tech badge */}
          <div className="inline-flex items-center gap-2 mb-8 px-4 py-1.5 rounded-full border text-xs font-medium" style={{ borderColor: "#333", color: "#888" }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: "var(--sf-purple)" }} />
            NVIDIA Nemotron · Claude AI · YOLOv12 · MediaPipe
          </div>

          <h1
            className="font-black leading-none mb-6"
            style={{
              fontSize: "clamp(3rem, 8vw, 7rem)",
              letterSpacing: "-0.04em",
              color: "var(--sf-white)",
            }}
          >
            Transform Expert<br />
            <span style={{ color: "var(--sf-lime)" }}>Knowledge</span> Into<br />
            Living Workflows
          </h1>

          <p className="text-lg max-w-2xl leading-relaxed" style={{ color: "#888" }}>
            Experts record a task once. AI analyzes every frame, detects UI elements, and generates an
            interactive annotated workflow — with live overlays and a Claude-powered copilot for trainees.
          </p>
        </div>
      </section>

      {/* MAIN ROLE CARDS */}
      <section className="border-b" style={{ borderColor: "var(--sf-black)" }}>
        <div className="grid grid-cols-1 md:grid-cols-2">

          {/* Expert card */}
          <Link href="/record" className="group block border-r" style={{ borderColor: "var(--sf-black)" }}>
            <div
              className="p-10 h-full min-h-[320px] flex flex-col justify-between transition-opacity duration-150 group-hover:opacity-90"
              style={{ backgroundColor: "var(--sf-purple)" }}
            >
              <div>
                <div className="text-5xl mb-6">🎬</div>
                <h2
                  className="font-black mb-3 leading-tight"
                  style={{ fontSize: "2rem", letterSpacing: "-0.03em", color: "var(--sf-black)" }}
                >
                  I&apos;m an Expert
                </h2>
                <p className="text-sm leading-relaxed" style={{ color: "rgba(0,0,0,0.65)" }}>
                  Record a task once. AI extracts key frames, detects UI elements, and builds a
                  step-by-step annotated workflow automatically.
                </p>
              </div>
              <div className="mt-8 flex items-center gap-2 font-bold text-sm" style={{ color: "var(--sf-black)" }}>
                Start Recording
                <span className="text-lg transition-transform duration-150 group-hover:translate-x-1">→</span>
              </div>
            </div>
          </Link>

          {/* Trainee card */}
          <Link href="/library" className="group block">
            <div
              className="p-10 h-full min-h-[320px] flex flex-col justify-between transition-opacity duration-150 group-hover:opacity-90"
              style={{ backgroundColor: "var(--sf-lime)" }}
            >
              <div>
                <div className="text-5xl mb-6">🎓</div>
                <h2
                  className="font-black mb-3 leading-tight"
                  style={{ fontSize: "2rem", letterSpacing: "-0.03em", color: "var(--sf-black)" }}
                >
                  I&apos;m a Trainee
                </h2>
                <p className="text-sm leading-relaxed" style={{ color: "rgba(0,0,0,0.65)" }}>
                  Watch expert recordings with live AI annotations, bounding boxes, and a Claude
                  copilot guiding you step by step.
                </p>
              </div>
              <div className="mt-8 flex items-center gap-2 font-bold text-sm" style={{ color: "var(--sf-black)" }}>
                Browse Workflows
                <span className="text-lg transition-transform duration-150 group-hover:translate-x-1">→</span>
              </div>
            </div>
          </Link>

        </div>
      </section>

      {/* SECONDARY MODE CARDS */}
      <section className="border-b" style={{ borderColor: "var(--sf-black)" }}>
        <div className="grid grid-cols-1 md:grid-cols-2">

          {/* Live Detection */}
          <Link href="/live" className="group block">
            <div
              className="p-8 h-full flex flex-col justify-between transition-opacity duration-150 group-hover:opacity-90"
              style={{ backgroundColor: "var(--sf-orange)" }}
            >
              <div className="flex items-start gap-5">
                <div className="text-4xl shrink-0">📷</div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="font-black text-lg leading-tight" style={{ letterSpacing: "-0.02em", color: "var(--sf-black)" }}>
                      Live Camera Detection
                    </h2>
                    <span
                      className="flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: "var(--sf-black)", color: "var(--sf-white)" }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                      LIVE
                    </span>
                  </div>
                  <p className="text-sm" style={{ color: "rgba(0,0,0,0.65)" }}>
                    Hand tracking · YOLO objects · Custom text detection — no setup needed
                  </p>
                </div>
              </div>
              <div className="mt-6 font-bold text-sm flex items-center gap-1" style={{ color: "var(--sf-black)" }}>
                Try now <span className="transition-transform duration-150 group-hover:translate-x-1">→</span>
              </div>
            </div>
          </Link>

        </div>
      </section>

      {/* FEATURE PILLS */}
      <section
        className="px-8 py-6 flex items-center justify-center gap-8 flex-wrap"
        style={{ backgroundColor: "var(--sf-black)" }}
      >
        {[
          { color: "var(--sf-purple)", label: "Vision Language Model analysis" },
          { color: "var(--sf-lime)", label: "Live annotation overlays" },
          { color: "var(--sf-orange)", label: "Claude AI copilot chat" },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-2 text-xs font-medium" style={{ color: "#888" }}>
            <span className="text-sm" style={{ color }}>✦</span>
            {label}
          </span>
        ))}
      </section>

    </div>
  );
}
