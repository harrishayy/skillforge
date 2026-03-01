"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { useWorkflowStore, selectedStep } from "@/store/workflow-store";
import { showSuccessToast } from "@/store/toast-store";
import { msToTimestamp } from "@/lib/video-utils";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { SectionModal } from "@/components/ui/SectionModal";

type ModalSection = "notes" | "transcript" | "description" | "regenerate" | "segments" | "rerun" | "delete" | null;

export function StepDetailPanel() {
  const store = useWorkflowStore();
  const step = selectedStep(store);
  const {
    segmentsByStep,
    segmentingStepId,
    regeneratingStepId,
    rerunningStepId,
    deletingStepId,
    saveStep,
    deleteStepById,
    removeSegment,
    clearSegments,
    regenerate,
    rerunPipeline,
  } = store;

  const [additionalContext, setAdditionalContext] = useState("");
  const [openModal, setOpenModal] = useState<ModalSection>(null);
  const [rerunClaude, setRerunClaude] = useState(true);
  const [rerunNemotron, setRerunNemotron] = useState(true);
  const [rerunSam3, setRerunSam3] = useState(true);

  const closeModal = useCallback(() => setOpenModal(null), []);

  if (!step) {
    return (
      <p className="text-sm" style={{ color: "#444" }}>Select a step from the left panel</p>
    );
  }

  const segments = segmentsByStep[step.id] ?? [];
  const isSegmenting = segmentingStepId === step.id;
  const isRegenerating = regeneratingStepId === step.id;
  const isRerunning = rerunningStepId === step.id;
  const isDeleting = deletingStepId === step.id;

  const handleRegenerate = () => {
    regenerate(step.id, additionalContext);
    setAdditionalContext("");
  };

  const handleRerunPipeline = async () => {
    const success = await rerunPipeline(step.id, {
      run_claude: rerunClaude,
      run_nemotron: rerunNemotron,
      run_sam3: rerunSam3,
    });
    if (success) {
      setOpenModal(null);
      showSuccessToast("Analysis redone! Video overlay updated.");
    }
  };

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto">
      {/* Step Title (editable) + Timeframes */}
      <div>
        <label className="block text-xs font-bold mb-1" style={{ color: "#666" }}>Step {step.step_number}</label>
        <EditableTitle stepId={step.id} title={step.title} saveStep={saveStep} />
        {step.end_ms > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
            <div className="flex items-center gap-1.5">
              <ClockIcon />
              <span className="text-xs font-mono" style={{ color: "#888" }}>
                {msToTimestamp(step.start_ms)}
              </span>
              <span className="text-[10px]" style={{ color: "#555" }}>→</span>
              <span className="text-xs font-mono" style={{ color: "#888" }}>
                {msToTimestamp(step.end_ms)}
              </span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: "#1a1a1a", color: "#777" }}>
              {msToTimestamp(step.end_ms - step.start_ms)} long
            </span>
          </div>
        )}
      </div>

      {/* Clickable section cards */}
      <div className="space-y-2">
        {/* Generated Description card (read-only, from Claude) */}
        <SectionCard
          label="GENERATED DESCRIPTION"
          accentColor="var(--sf-purple)"
          icon={<BotIcon />}
          preview={step.description?.trim() || "No AI description generated"}
          hasContent={!!step.description?.trim()}
          onClick={() => setOpenModal("description")}
        />

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

        {/* Redo Analysis card */}
        <SectionCard
          label="REDO ANALYSIS"
          accentColor="var(--sf-orange)"
          icon={<RefreshIcon />}
          preview={
            isRerunning
              ? "Re-running pipeline..."
              : "Re-run the multi-agent pipeline — video overlay updates automatically"
          }
          hasContent={false}
          onClick={() => setOpenModal("rerun")}
          badge={isRerunning ? "Running..." : undefined}
        />
      </div>

      {/* Regenerate card */}
      <div className="space-y-2">
        <SectionCard
          label="REGENERATE WITH CONTEXT"
          accentColor="var(--sf-purple)"
          icon={<BotIcon />}
          preview={isRegenerating ? "Regenerating..." : "Add context to improve AI output"}
          hasContent={!!additionalContext.trim()}
          onClick={() => setOpenModal("regenerate")}
          badge={isRegenerating ? "Regenerating..." : undefined}
        />
      </div>

      {/* Delete step card */}
      <div className="mt-auto pt-4">
        <SectionCard
          label="DELETE STEP"
          accentColor="var(--sf-orange)"
          icon={<TrashSmallIcon />}
          preview={isDeleting ? "Deleting..." : "Permanently remove this step and all its data"}
          hasContent={false}
          onClick={() => setOpenModal("delete")}
          badge={isDeleting ? "Deleting..." : undefined}
        />
      </div>

      {/* ── Modals ────────────────────────────────────────────── */}

      {/* Generated Description modal (read-only) */}
      <SectionModal
        open={openModal === "description"}
        onClose={closeModal}
        title={`Step ${step.step_number} — Generated Description`}
        accentColor="var(--sf-purple)"
        icon={<BotIcon />}
      >
        {step.description?.trim() ? (
          <div>
            <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "#ccc" }}>
              {step.description}
            </p>
            <p className="text-xs mt-3" style={{ color: "rgba(255,255,255,0.25)" }}>
              This description was generated by Claude from the voice transcript and notes.
            </p>
          </div>
        ) : (
          <p className="text-sm" style={{ color: "#555" }}>
            No AI description was generated for this step. Try regenerating with additional context.
          </p>
        )}
      </SectionModal>

      {/* Regenerate modal */}
      <SectionModal
        open={openModal === "regenerate"}
        onClose={closeModal}
        title={`Step ${step.step_number} — Regenerate with Context`}
        accentColor="var(--sf-purple)"
        icon={<BotIcon />}
      >
        <div className="space-y-3">
          <textarea
            value={additionalContext}
            onChange={(e) => setAdditionalContext(e.target.value)}
            placeholder="Add extra context to improve AI output..."
            rows={5}
            className="w-full rounded-lg px-4 py-3 text-sm outline-none resize-y leading-relaxed"
            style={{ backgroundColor: "#111", border: "1px solid #333", color: "var(--sf-white)", minHeight: 120 }}
          />
          <Button size="sm" onClick={handleRegenerate} disabled={isRegenerating}>
            {isRegenerating && <Spinner className="w-3.5 h-3.5" />}
            {isRegenerating ? "Regenerating..." : "Regenerate Step"}
          </Button>
          <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
            Provide additional context to refine the AI-generated description and analysis for this step.
          </p>
        </div>
      </SectionModal>

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

      {/* Segments modal */}
      <SectionModal
        open={openModal === "segments"}
        onClose={closeModal}
        title={`Step ${step.step_number} — SAM3 Segments`}
        accentColor="var(--sf-yellow)"
        icon={<GridIcon />}
      >
        <div className="space-y-2">
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

      {/* Delete Step modal */}
      <SectionModal
        open={openModal === "delete"}
        onClose={closeModal}
        title={`Step ${step.step_number} — Delete Step`}
        accentColor="var(--sf-orange)"
        icon={<TrashSmallIcon />}
      >
        <div className="space-y-4">
          <div className="rounded-lg p-4" style={{ backgroundColor: "rgba(255,100,50,0.06)", border: "1px solid rgba(255,100,50,0.2)" }}>
            <p className="text-sm font-medium mb-1" style={{ color: "var(--sf-orange)" }}>
              This action cannot be undone
            </p>
            <p className="text-xs leading-relaxed" style={{ color: "#888" }}>
              Deleting &ldquo;{step.title}&rdquo; will permanently remove the step along with all
              its annotations, click targets, and frame data. Remaining steps will be renumbered.
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                await deleteStepById(step.id);
                closeModal();
              }}
              disabled={isDeleting}
            >
              {isDeleting && <Spinner className="w-3.5 h-3.5" />}
              {isDeleting ? "Deleting..." : "Delete Step"}
            </Button>
            <Button size="sm" variant="ghost" onClick={closeModal} style={{ color: "#888", border: "1px solid #333" }}>
              Cancel
            </Button>
          </div>
        </div>
      </SectionModal>

      {/* Redo Analysis modal */}
      <SectionModal
        open={openModal === "rerun"}
        onClose={closeModal}
        title={`Step ${step.step_number} — Redo Analysis`}
        accentColor="var(--sf-orange)"
        icon={<RefreshIcon />}
      >
        <div className="space-y-4">
          <p className="text-xs" style={{ color: "#888" }}>
            Select which agents to re-run for this step. Later agents depend on earlier ones.
          </p>

          <div className="space-y-2">
            <AgentCheckbox
              label="Claude — Key Object Identification"
              description="Re-identify the key object from step context (title, transcript, notes)"
              checked={rerunClaude}
              onChange={setRerunClaude}
              accentColor="var(--sf-purple)"
            />
            <AgentCheckbox
              label="Nemotron VL — Frame Scanning"
              description="Re-scan all frames for the key object presence"
              checked={rerunNemotron}
              onChange={setRerunNemotron}
              accentColor="var(--sf-yellow)"
            />
            <AgentCheckbox
              label="SAM3 — Segmentation"
              description="Re-segment the key object in detected frames and update video overlay"
              checked={rerunSam3}
              onChange={setRerunSam3}
              accentColor="var(--sf-lime)"
            />
          </div>

          <Button
            size="sm"
            onClick={handleRerunPipeline}
            disabled={isRerunning || (!rerunClaude && !rerunNemotron && !rerunSam3)}
          >
            {isRerunning && <Spinner className="w-3.5 h-3.5" />}
            {isRerunning ? "Running Pipeline..." : "Re-run Pipeline"}
          </Button>
          <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
            The segmentation overlay on the Video tab updates automatically once the pipeline finishes.
          </p>
        </div>
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
          <span className="text-[9px] ml-auto px-1.5 py-0.5 rounded-full flex items-center gap-1" style={{ backgroundColor: `${accentColor}25`, color: accentColor }}>
            <svg className="w-2.5 h-2.5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
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

/* ── Editable Title (inline in header) ────────────────────────── */

function EditableTitle({
  stepId,
  title,
  saveStep,
}: {
  stepId: string;
  title: string;
  saveStep: (id: string, fields: { title?: string }) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(title);
  }, [title, stepId]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = async () => {
    setIsEditing(false);
    const trimmed = value.trim();
    if (trimmed && trimmed !== title) {
      await saveStep(stepId, { title: trimmed });
    } else {
      setValue(title);
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") { setValue(title); setIsEditing(false); }
        }}
        className="w-full text-sm font-medium rounded px-2 py-1 outline-none"
        style={{ backgroundColor: "#1a1a1a", color: "var(--sf-white)", border: "1px solid var(--sf-purple)" }}
      />
    );
  }

  return (
    <p
      className="text-sm font-medium cursor-text rounded px-2 py-1 -mx-2 transition-colors"
      style={{ color: "var(--sf-white)" }}
      onClick={() => setIsEditing(true)}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)")}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
      title="Click to edit title"
    >
      {title}
    </p>
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

function RefreshIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}

function TrashSmallIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

/* ── Agent Checkbox ──────────────────────────────────────────── */

function AgentCheckbox({
  label,
  description,
  checked,
  onChange,
  accentColor,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  accentColor: string;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="w-full flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-all"
      style={{
        backgroundColor: checked ? `${accentColor}10` : "#111",
        border: `1px solid ${checked ? `${accentColor}30` : "#222"}`,
      }}
    >
      <div
        className="mt-0.5 w-4 h-4 rounded shrink-0 flex items-center justify-center transition-all"
        style={{
          backgroundColor: checked ? accentColor : "transparent",
          border: `2px solid ${checked ? accentColor : "#444"}`,
        }}
      >
        {checked && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--sf-black)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </div>
      <div>
        <p className="text-xs font-bold" style={{ color: checked ? accentColor : "#888" }}>
          {label}
        </p>
        <p className="text-[10px] mt-0.5" style={{ color: "#555" }}>
          {description}
        </p>
      </div>
    </button>
  );
}

