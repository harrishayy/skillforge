import { forwardRef } from "react";
import { clsx } from "clsx";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className, style, children, ...props }, ref) => {
    const variantStyles: React.CSSProperties =
      variant === "primary"
        ? { backgroundColor: "var(--sf-black)", color: "var(--sf-white)", border: "1px solid var(--sf-black)" }
        : variant === "secondary"
        ? { backgroundColor: "var(--sf-white)", color: "var(--sf-black)", border: "1px solid var(--sf-black)" }
        : variant === "ghost"
        ? { backgroundColor: "transparent", color: "var(--sf-black)", border: "1px solid transparent" }
        : { backgroundColor: "var(--sf-orange)", color: "var(--sf-black)", border: "1px solid var(--sf-orange)" };

    return (
      <button
        ref={ref}
        className={clsx(
          "inline-flex items-center justify-center gap-2 font-bold rounded-xl transition-opacity duration-150 hover:opacity-80 active:opacity-70 disabled:opacity-40 disabled:cursor-not-allowed",
          {
            "text-xs px-3 py-1.5": size === "sm",
            "text-sm px-5 py-2.5": size === "md",
            "text-base px-7 py-3.5": size === "lg",
          },
          className
        )}
        style={{ ...variantStyles, ...style }}
        {...props}
      >
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
