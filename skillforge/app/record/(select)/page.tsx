"use client";
import { useRouter } from "next/navigation";
import { ModeSelector } from "@/components/recording/ModeSelector";

export default function RecordPage() {
  const router = useRouter();

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-2xl">
        <ModeSelector onExpertSelect={() => router.push("/record/setup")} />
      </div>
    </div>
  );
}
