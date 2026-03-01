"use client";
import { create } from "zustand";
import type { ChatMessage, Subtask } from "@/types";

interface PlayerStore {
  currentStepIndex: number;
  currentTimeMs: number;
  isPlaying: boolean;
  isPausedAtStepEnd: boolean;
  /** 0-1 float representing video progress within the current step. */
  stepProgress: number;
  chatHistory: ChatMessage[];
  isCopilotLoading: boolean;
  currentInstruction: string;
  subtasksByStep: Record<string, Subtask[]>;
  currentSubtaskIndexByStep: Record<string, number>;
  suggestCompleteForStep: string | null;
  suggestCompleteMessage: string | null;

  setCurrentStepIndex: (i: number) => void;
  setCurrentTimeMs: (ms: number) => void;
  setIsPlaying: (v: boolean) => void;
  setIsPausedAtStepEnd: (v: boolean) => void;
  setStepProgress: (v: number) => void;
  addChatMessage: (msg: ChatMessage) => void;
  updateLastAssistantMessage: (chunk: string) => void;
  setIsCopilotLoading: (v: boolean) => void;
  setCurrentInstruction: (s: string) => void;
  setSubtasksForStep: (stepId: string, subtasks: Subtask[]) => void;
  setCurrentSubtaskIndex: (stepId: string, index: number) => void;
  clearSubtasksForStep: (stepId: string) => void;
  setSuggestComplete: (stepId: string | null, message: string | null) => void;
  reset: () => void;
}

const initialState = {
  currentStepIndex: 0,
  currentTimeMs: 0,
  isPlaying: false,
  isPausedAtStepEnd: false,
  stepProgress: 0,
  chatHistory: [] as ChatMessage[],
  isCopilotLoading: false,
  currentInstruction: "",
  subtasksByStep: {} as Record<string, Subtask[]>,
  currentSubtaskIndexByStep: {} as Record<string, number>,
  suggestCompleteForStep: null as string | null,
  suggestCompleteMessage: null as string | null,
};

export const usePlayerStore = create<PlayerStore>((set) => ({
  ...initialState,

  setCurrentStepIndex: (i) => set({ currentStepIndex: i }),
  setCurrentTimeMs: (ms) => set({ currentTimeMs: ms }),
  setIsPlaying: (v) => set({ isPlaying: v }),
  setIsPausedAtStepEnd: (v) => set({ isPausedAtStepEnd: v }),
  setStepProgress: (v) => set({ stepProgress: v }),
  setCurrentInstruction: (s) => set({ currentInstruction: s }),

  addChatMessage: (msg) =>
    set((state) => ({ chatHistory: [...state.chatHistory, msg] })),

  updateLastAssistantMessage: (chunk) =>
    set((state) => {
      const history = [...state.chatHistory];
      if (history.length && history[history.length - 1].role === "assistant") {
        history[history.length - 1] = {
          ...history[history.length - 1],
          content: history[history.length - 1].content + chunk,
        };
      } else {
        history.push({ role: "assistant", content: chunk, timestamp: Date.now() });
      }
      return { chatHistory: history };
    }),

  setIsCopilotLoading: (v) => set({ isCopilotLoading: v }),

  setSubtasksForStep: (stepId, subtasks) =>
    set((s) => ({
      subtasksByStep: { ...s.subtasksByStep, [stepId]: subtasks },
      currentSubtaskIndexByStep: { ...s.currentSubtaskIndexByStep, [stepId]: 0 },
    })),

  setCurrentSubtaskIndex: (stepId, index) =>
    set((s) => ({
      currentSubtaskIndexByStep: { ...s.currentSubtaskIndexByStep, [stepId]: index },
    })),

  clearSubtasksForStep: (stepId) =>
    set((s) => {
      const { [stepId]: _, ...rest } = s.subtasksByStep;
      const { [stepId]: __, ...restIdx } = s.currentSubtaskIndexByStep;
      return { subtasksByStep: rest, currentSubtaskIndexByStep: restIdx };
    }),

  setSuggestComplete: (stepId, message) =>
    set({ suggestCompleteForStep: stepId, suggestCompleteMessage: message }),

  reset: () => set(initialState),
}));
