import { clsx } from "clsx";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "blue" | "amber" | "green" | "red" | "zinc";
  className?: string;
}

const variantStyles: Record<string, React.CSSProperties> = {
  blue: { backgroundColor: "var(--sf-purple)", color: "var(--sf-black)" },
  amber: { backgroundColor: "var(--sf-yellow)", color: "var(--sf-black)" },
  green: { backgroundColor: "var(--sf-lime)", color: "var(--sf-black)" },
  red: { backgroundColor: "var(--sf-orange)", color: "var(--sf-black)" },
  zinc: { backgroundColor: "#e0e0d8", color: "var(--sf-black)" },
};

export function Badge({ children, variant = "blue", className }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full",
        className
      )}
      style={variantStyles[variant]}
    >
      {children}
    </span>
  );
}
