"use client";

export interface SessionPanels {
  steps: boolean;
  helpChat: boolean;
}

interface SessionToolbarProps {
  panels: SessionPanels;
  onTogglePanel: (panel: keyof SessionPanels) => void;
  onExit: () => void;
}

const PANEL_CONFIG: Array<{
  key: keyof SessionPanels;
  label: string;
  icon: React.ReactNode;
}> = [
  {
    key: "steps",
    label: "Steps",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v20M2 12h20" />
      </svg>
    ),
  },
  {
    key: "helpChat",
    label: "Help & Chat",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
];

export function SessionToolbar({ panels, onTogglePanel, onExit }: SessionToolbarProps) {
  return (
    <div
      className="fixed right-4 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-2 p-2 rounded-2xl"
      style={{
        backgroundColor: "rgba(0, 0, 0, 0.4)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(255, 255, 255, 0.1)",
      }}
    >
      <button
        onClick={onExit}
        className="w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:scale-105"
        style={{
          backgroundColor: "rgba(255, 255, 255, 0.1)",
          color: "var(--sf-white)",
        }}
        title="Exit recording session"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>

      <div className="w-full h-px" style={{ backgroundColor: "rgba(255,255,255,0.1)" }} />

      {PANEL_CONFIG.map(({ key, label, icon }) => {
        const active = panels[key];
        return (
          <button
            key={key}
            onClick={() => onTogglePanel(key)}
            className="w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:scale-105 relative"
            style={{
              backgroundColor: active
                ? "rgba(190, 242, 100, 0.25)"
                : "rgba(255, 255, 255, 0.05)",
              color: active ? "var(--sf-lime)" : "rgba(255, 255, 255, 0.5)",
            }}
            title={`${active ? "Hide" : "Show"} ${label}`}
          >
            {icon}
            {active && (
              <span
                className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full"
                style={{ backgroundColor: "var(--sf-lime)" }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
