"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { useWorkflowStore, selectedStep } from "@/store/workflow-store";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { SectionModal } from "@/components/ui/SectionModal";

type ModalSection = "notes" | "transcript" | "summary" | "segments" | "targets" | null;

export function StepDetailPanel() {
  const store = useWorkflowStore();
  const step = selectedStep(store);
  const {
    segmentsByStep,
    segmentingStepId,
    regeneratingStepId,
    saveStep,
    removeSegment,
    clearSegments,
    regenerate,
  } = store;

  const [additionalContext, setAdditionalContext] = useState("");
  const [openModal, setOpenModal] = useState<ModalSection>(null);

  const closeModal = useCallback(() => setOpenModal(null), []);

  if (!step) {
    return (
      <p className="text-sm" style={{ color: "#444" }}>Select a step from the left panel</p>
    );
  }

  const segments = segmentsByStep[step.id] ?? [];
  const isSegmenting = segmentingStepId === step.id;
  const isRegenerating = regeneratingStepId === step.id;

  const handleRegenerate = () => {
    regenerate(step.id, additionalContext);
    setAdditionalContext("");
  };

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto">
      {/* Step Title */}
      <div>
        <label className="block text-xs font-bold mb-1" style={{ color: "#666" }}>Step Title</label>
        <p className="text-sm font-medium" style={{ color: "var(--sf-white)" }}>{step.title}</p>
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs font-bold mb-1" style={{ color: "#666" }}>Description</label>
        <textarea
          defaultValue={step.description ?? ""}
          key={`desc-${step.id}`}
          rows={2}
          placeholder="Add instructions for the trainee..."
          className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
          style={{ backgroundColor: "#111", border: "1px solid #333", color: "var(--sf-white)" }}
          onBlur={async (e) => {
            await saveStep(step.id, { description: e.target.value });
          }}
        />
      </div>

      {/* Clickable section cards */}
      <div className="space-y-2">
        {/* Notes card */}
        <SectionCard
          label="NOTES"
          accentColor="var(--sf-yellow)"
          icon={<PenIcon />}
          preview={step.note?.trim() || "No notes — click to add"}
          hasContent={!!step.note?.trim()}
          onClick={() => setOpenModal("notes")}
        />

        {/* Transcript card */}
        <SectionCard
          label="VOICE TRANSCRIPT"
          accentColor="var(--sf-lime)"
          icon={<MicIcon />}
          preview={step.transcript?.trim() || "No transcript available"}
          hasContent={!!step.transcript?.trim()}
          onClick={() => setOpenModal("transcript")}
        />

        {/* AI Summary card */}
        <SectionCard
          label="AI SUMMARY"
          accentColor="var(--sf-purple)"
          icon={<BotIcon />}
          preview={step.ai_description?.trim() || "No summary available"}
          hasContent={!!step.ai_description?.trim()}
          onClick={() => setOpenModal("summary")}
        />

        {/* Segments card */}
        <SectionCard
          label={`SAM3 SEGMENTS (${segments.length})`}
          accentColor="var(--sf-yellow)"
          icon={<GridIcon />}
          preview={
            segments.length > 0
              ? `${segments.length} segment${segments.length > 1 ? "s" : ""} detected${step.sam3_prompt ? ` · "${step.sam3_prompt}"` : ""}`
              : "No segments — click frame to add"
          }
          hasContent={segments.length > 0}
          onClick={() => setOpenModal("segments")}
          badge={isSegmenting ? "Segmenting..." : undefined}
        />

        {/* Click targets card */}
        <SectionCard
          label={`CLICK TARGETS (${step.click_targets.length})`}
          accentColor="var(--sf-lime)"
          icon={<TargetIcon />}
          preview={
            step.click_targets.length > 0
              ? `${step.click_targets.length} target${step.click_targets.length > 1 ? "s" : ""} detected`
              : "No click targets detected"
          }
          hasContent={step.click_targets.length > 0}
          onClick={() => setOpenModal("targets")}
        />
      </div>

      {/* Regenerate (always visible inline) */}
      <div className="rounded-lg p-3 space-y-2" style={{ backgroundColor: "#0d0d1a", border: "1px solid rgba(122,120,255,0.3)" }}>
        <label className="block text-[10px] font-bold" style={{ color: "var(--sf-purple)" }}>
          Regenerate with context
          {isRegenerating && (
            <span className="ml-2 font-normal" style={{ color: "var(--sf-purple)" }}>
              <Spinner className="w-3 h-3 inline" /> Regenerating...
            </span>
          )}
        </label>
        <textarea
          value={additionalContext}
          onChange={(e) => setAdditionalContext(e.target.value)}
          placeholder="Add extra context to improve AI output..."
          rows={2}
          className="w-full rounded-md px-2.5 py-2 text-xs outline-none resize-none"
          style={{ backgroundColor: "#111", border: "1px solid #333", color: "var(--sf-white)" }}
        />
        <Button size="sm" onClick={handleRegenerate} disabled={isRegenerating}>
          {isRegenerating ? "Regenerating..." : "Regenerate Step"}
        </Button>
      </div>

      {/* ── Modals ────────────────────────────────────────────── */}

      {/* Notes modal */}
      <SectionModal
        open={openModal === "notes"}
        onClose={closeModal}
        title={`Step ${step.step_number} — Notes`}
        accentColor="var(--sf-yellow)"
        icon={<PenIcon />}
      >
        <NotesSectionExpanded stepId={step.id} note={step.note} saveStep={saveStep} />
      </SectionModal>

      {/* Transcript modal */}
      <SectionModal
        open={openModal === "transcript"}
        onClose={closeModal}
        title={`Step ${step.step_number} — Voice Transcript`}
        accentColor="var(--sf-lime)"
        icon={<MicIcon />}
      >
        {step.transcript?.trim() ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "#ccc" }}>
            {step.transcript}
          </p>
        ) : (
          <p className="text-sm" style={{ color: "#555" }}>No voice transcript was captured for this step.</p>
        )}
      </SectionModal>

      {/* AI Summary modal */}
      <SectionModal
        open={openModal === "summary"}
        onClose={closeModal}
        title={`Step ${step.step_number} — AI Summary`}
        accentColor="var(--sf-purple)"
        icon={<BotIcon />}
      >
        {step.ai_description?.trim() ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "#ccc" }}>
            {step.ai_description}
          </p>
        ) : (
          <p className="text-sm" style={{ color: "#555" }}>No AI summary available for this step.</p>
        )}
      </SectionModal>

      {/* Segments modal */}
      <SectionModal
        open={openModal === "segments"}
        onClose={closeModal}
        title={`Step ${step.step_number} — SAM3 Segments`}
        accentColor="var(--sf-yellow)"
        icon={<GridIcon />}
      >
        <div className="space-y-2">
          {/* SAM3 prompt used for segmentation (read-only) */}
          {step.sam3_prompt && (
            <div className="rounded-lg px-3.5 py-2.5" style={{ backgroundColor: "rgba(255,196,18,0.06)", border: "1px solid rgba(255,196,18,0.15)" }}>
              <label className="block text-[10px] font-bold mb-1" style={{ color: "var(--sf-yellow)" }}>
                SEGMENTATION PROMPT
              </label>
              <p className="text-xs leading-relaxed" style={{ color: "#aaa" }}>
                {step.sam3_prompt}
              </p>
            </div>
          )}

          {segments.length > 0 && (
            <div className="flex justify-end mb-2">
              <button
                onClick={() => clearSegments(step.id)}
                className="text-xs font-medium transition-colors"
                style={{ color: "var(--sf-orange)" }}
              >
                Clear all
              </button>
            </div>
          )}
          {segments.length > 0 ? (
            <div className="space-y-2">
              {segments.map((seg, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg px-4 py-3"
                  style={{ backgroundColor: "#111", border: "1px solid #222" }}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-4 h-4 rounded-sm shrink-0" style={{ backgroundColor: "var(--sf-yellow)" }} />
                    <span className="text-sm" style={{ color: "#aaa" }}>Segment {i + 1}</span>
                    <span className="text-xs" style={{ color: "#666" }}>
                      {(seg.score * 100).toFixed(0)}% confidence
                    </span>
                  </div>
                  <button
                    onClick={() => removeSegment(step.id, i)}
                    className="text-xs font-medium px-2 py-1 rounded transition-colors"
                    style={{ color: "var(--sf-orange)" }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg p-6 text-center" style={{ backgroundColor: "#111", border: "1px dashed #333" }}>
              <p className="text-sm mb-1" style={{ color: "#666" }}>No segments added yet</p>
              <p className="text-xs" style={{ color: "#444" }}>Click on the frame in the center panel to add SAM3 segmentations</p>
            </div>
          )}
        </div>
      </SectionModal>

      {/* Click targets modal */}
      <SectionModal
        open={openModal === "targets"}
        onClose={closeModal}
        title={`Step ${step.step_number} — Click Targets`}
        accentColor="var(--sf-lime)"
        icon={<TargetIcon />}
      >
        {step.click_targets.length > 0 ? (
          <div className="space-y-2">
            {step.click_targets.map((ct) => (
              <div
                key={ct.id}
                className="flex items-center gap-3 rounded-lg px-4 py-3"
                style={{ backgroundColor: "#111", border: "1px solid #222" }}
              >
                <span
                  className="text-sm shrink-0"
                  style={{ color: ct.is_primary ? "var(--sf-lime)" : "#555" }}
                >
                  {ct.is_primary ? "★" : "○"}
                </span>
                <div>
                  <p className="text-sm" style={{ color: "#aaa" }}>
                    {ct.element_text ?? ct.element_type ?? "element"}
                  </p>
                  {ct.confidence != null && (
                    <p className="text-xs" style={{ color: "#555" }}>
                      {(ct.confidence * 100).toFixed(0)}% confidence · {ct.action}
                    </p>
                  )}
                </div>
                {ct.is_primary && (
                  <span
                    className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: "rgba(190,242,100,0.12)", color: "var(--sf-lime)" }}
                  >
                    Primary
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm" style={{ color: "#555" }}>No click targets detected for this step.</p>
        )}
      </SectionModal>
    </div>
  );
}

/* ── Section Card ──────────────────────────────────────────────── */

function SectionCard({
  label,
  accentColor,
  icon,
  preview,
  hasContent,
  onClick,
  badge,
}: {
  label: string;
  accentColor: string;
  icon: React.ReactNode;
  preview: string;
  hasContent: boolean;
  onClick: () => void;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-lg p-2.5 text-left transition-all group"
      style={{
        backgroundColor: hasContent ? `${accentColor}08` : "#0d0d0d",
        border: `1px solid ${hasContent ? `${accentColor}20` : "#1a1a1a"}`,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = `${accentColor}50`;
        e.currentTarget.style.backgroundColor = `${accentColor}12`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = hasContent ? `${accentColor}20` : "#1a1a1a";
        e.currentTarget.style.backgroundColor = hasContent ? `${accentColor}08` : "#0d0d0d";
      }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span style={{ color: accentColor }}>{icon}</span>
        <span className="text-[10px] font-bold" style={{ color: accentColor }}>{label}</span>
        {badge && (
          <span className="text-[9px] ml-auto px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${accentColor}25`, color: accentColor }}>
            {badge}
          </span>
        )}
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: "#555" }}
        >
          <path d="M7 17L17 7" />
          <path d="M7 7h10v10" />
        </svg>
      </div>
      <p
        className="text-xs leading-relaxed line-clamp-2"
        style={{ color: hasContent ? "#888" : "#444" }}
      >
        {preview}
      </p>
    </button>
  );
}

/* ── Notes Expanded (editable in modal) ───────────────────────── */

function NotesSectionExpanded({
  stepId,
  note,
  saveStep,
}: {
  stepId: string;
  note?: string;
  saveStep: (id: string, fields: { note?: string }) => Promise<void>;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.value = note ?? "";
      textareaRef.current.focus();
    }
  }, [stepId, note]);

  return (
    <div>
      <textarea
        ref={textareaRef}
        defaultValue={note ?? ""}
        key={stepId}
        rows={10}
        placeholder="Add or edit notes for this step..."
        className="w-full rounded-lg px-4 py-3 text-sm outline-none resize-y leading-relaxed"
        style={{ backgroundColor: "#111", border: "1px solid #333", color: "var(--sf-white)", minHeight: 200 }}
        onBlur={async (e) => {
          await saveStep(stepId, { note: e.target.value });
        }}
      />
      <p className="text-xs mt-2" style={{ color: "rgba(255,255,255,0.3)" }}>
        Notes supplement the voice transcript to improve AI analysis. Changes are saved automatically.
      </p>
    </div>
  );
}

/* ── Icons ─────────────────────────────────────────────────────── */

function PenIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}

function BotIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </svg>
  );
}

function TargetIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}
