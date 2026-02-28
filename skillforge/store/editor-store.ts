"use client";
import { create } from "zustand";
import type { EditorTool } from "@/types";

interface EditorStore {
  activeTool: EditorTool;
  activeColor: string;
  isDirty: boolean;
  setTool: (tool: EditorTool) => void;
  setColor: (color: string) => void;
  setDirty: (v: boolean) => void;
}

export const useEditorStore = create<EditorStore>((set) => ({
  activeTool: "select",
  activeColor: "#3B82F6",
  isDirty: false,
  setTool: (tool) => set({ activeTool: tool }),
  setColor: (color) => set({ activeColor: color }),
  setDirty: (v) => set({ isDirty: v }),
}));
