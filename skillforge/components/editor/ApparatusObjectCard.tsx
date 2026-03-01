"use client";
import { useState, useEffect, useRef } from "react";
import type { ApparatusObject } from "@/types";
import { useWorkflowStore } from "@/store/workflow-store";
import { frameUrl } from "@/lib/constants";

interface ApparatusObjectCardProps {
  object: ApparatusObject;
}

export function ApparatusObjectCard({ object }: ApparatusObjectCardProps) {
  const { saveApparatusObject } = useWorkflowStore();
  const [isEditingName, setIsEditingName] = useState(false);
  const [name, setName] = useState(object.object_name);
  const [desc, setDesc] = useState(object.description || object.visual_cues || "");
  const descRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isEditingName) setName(object.object_name);
  }, [object.object_name, isEditingName]);

  useEffect(() => {
    setDesc(object.description || object.visual_cues || "");
  }, [object.description, object.visual_cues]);

  const handleSaveName = async () => {
    setIsEditingName(false);
    if (name !== object.object_name) {
      await saveApparatusObject(object.id, { object_name: name });
    }
  };

  const handleSaveDescription = async () => {
    const current = object.description || object.visual_cues || "";
    if (desc !== current) {
      await saveApparatusObject(object.id, { description: desc });
    }
  };

  const thumbnailSrc = object.segmented_reference_path
    ? frameUrl(object.segmented_reference_path)
    : object.reference_frame_paths?.[0]
      ? frameUrl(object.reference_frame_paths[0])
      : null;

  return (
    <div
      className="flex gap-3 p-2.5 rounded-lg transition-all"
      style={{ border: "1px solid #222", backgroundColor: "#0d0d0d" }}
    >
      {/* Thumbnail */}
      <div
        className="shrink-0 rounded overflow-hidden"
        style={{
          width: 52,
          height: 52,
          backgroundColor: "#1a1a1a",
          border: "1px solid #333",
        }}
      >
        {thumbnailSrc ? (
          <img
            src={thumbnailSrc}
            alt={object.object_name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center text-xs"
            style={{ color: "#555" }}
          >
            ?
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          {isEditingName ? (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={handleSaveName}
              onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
              className="flex-1 text-xs font-medium rounded px-1.5 py-0.5 outline-none"
              style={{
                backgroundColor: "#1a1a1a",
                color: "var(--sf-white)",
                border: "1px solid #444",
              }}
              autoFocus
            />
          ) : (
            <span
              className="text-xs font-medium truncate cursor-default"
              style={{ color: "var(--sf-white)" }}
              onDoubleClick={() => setIsEditingName(true)}
            >
              {object.object_name}
            </span>
          )}
          <span
            className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: "#1f1f1f", color: "#888", border: "1px solid #333" }}
          >
            {object.object_type}
          </span>
        </div>

        <textarea
          ref={descRef}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={handleSaveDescription}
          rows={2}
          placeholder="Add description..."
          className="w-full text-[11px] leading-tight rounded px-1.5 py-1 outline-none resize-none"
          style={{
            backgroundColor: "transparent",
            color: "#999",
            border: "1px solid transparent",
          }}
          onFocus={(e) => {
            (e.target as HTMLTextAreaElement).style.borderColor = "#444";
            (e.target as HTMLTextAreaElement).style.backgroundColor = "#1a1a1a";
          }}
          onBlurCapture={(e) => {
            (e.target as HTMLTextAreaElement).style.borderColor = "transparent";
            (e.target as HTMLTextAreaElement).style.backgroundColor = "transparent";
          }}
        />
      </div>
    </div>
  );
}
