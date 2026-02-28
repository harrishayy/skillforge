"use client";

export interface OverlayPanels {
  options: boolean;
  chat: boolean;
  stats: boolean;
}

interface ImmersiveToolbarProps {
  panels: OverlayPanels;
  onTogglePanel: (panel: keyof OverlayPanels) => void;
  onExit: () => void;
}

const PANEL_CONFIG: Array<{
  key: keyof OverlayPanels;
  label: string;
  icon: React.ReactNode;
}> = [
  {
    key: "options",
    label: "Options",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    key: "chat",
    label: "Chat",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    key: "stats",
    label: "Stats",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" />
        <path d="m19 9-5 5-4-4-3 3" />
      </svg>
    ),
  },
];

export function ImmersiveToolbar({ panels, onTogglePanel, onExit }: ImmersiveToolbarProps) {
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
      {/* Exit immersive */}
      <button
        onClick={onExit}
        className="w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:scale-105"
        style={{
          backgroundColor: "rgba(255, 255, 255, 0.1)",
          color: "var(--sf-white)",
        }}
        title="Exit immersive (Esc)"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3v3a2 2 0 0 1-2 2H3" />
          <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
          <path d="M3 16h3a2 2 0 0 1 2 2v3" />
          <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
        </svg>
      </button>

      <div className="w-full h-px" style={{ backgroundColor: "rgba(255,255,255,0.1)" }} />

      {/* Panel toggles */}
      {PANEL_CONFIG.map(({ key, label, icon }) => {
        const active = panels[key];
        return (
          <button
            key={key}
            onClick={() => onTogglePanel(key)}
            className="w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:scale-105 relative"
            style={{
              backgroundColor: active
                ? "rgba(var(--sf-lime-rgb, 190, 242, 100), 0.25)"
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
