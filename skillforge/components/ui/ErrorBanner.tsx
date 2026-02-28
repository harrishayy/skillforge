interface ErrorBannerProps {
  message: string;
  className?: string;
}

export function ErrorBanner({ message, className }: ErrorBannerProps) {
  return (
    <div
      className={`rounded-lg px-4 py-3 text-sm font-medium ${className ?? ""}`}
      style={{
        backgroundColor: "rgba(255,109,56,0.1)",
        border: "1px solid var(--sf-orange)",
        color: "var(--sf-orange)",
      }}
    >
      {message}
    </div>
  );
}
