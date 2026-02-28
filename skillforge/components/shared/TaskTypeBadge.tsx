import { Badge } from "@/components/ui/Badge";
import type { TaskMode } from "@/types";

export function TaskTypeBadge({ mode }: { mode: TaskMode }) {
  return (
    <Badge variant={mode === "software" ? "blue" : "amber"}>
      {mode === "software" ? "💻 Software" : "🔧 Hardware"}
    </Badge>
  );
}
