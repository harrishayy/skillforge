interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  color?: "green" | "blue" | "orange";
  className?: string;
}

const colorTokens = {
  green: "var(--sf-lime)",
  blue: "var(--sf-purple)",
  orange: "var(--sf-orange)",
};

const textTokens = {
  green: "var(--sf-black)",
  blue: "var(--sf-black)",
  orange: "var(--sf-black)",
};

export function Toggle({ checked, onChange, label, color = "green", className }: ToggleProps) {
  return (
    <label className={`flex items-center gap-3 cursor-pointer group ${className ?? ""}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="w-9 h-5 rounded-full transition-colors relative shrink-0"
        style={{ backgroundColor: checked ? colorTokens[color] : "#333" }}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full shadow transition-transform ${
            checked ? "translate-x-4" : ""
          }`}
          style={{ backgroundColor: checked ? textTokens[color] : "#888" }}
        />
      </button>
      {label && (
        <span
          className="text-sm transition-colors"
          style={{ color: "#aaa" }}
        >
          {label}
        </span>
      )}
    </label>
  );
}
