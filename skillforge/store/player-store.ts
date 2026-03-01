"use client";
import { create } from "zustand";
import type { ChatMessage } from "@/types";

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

  setCurrentStepIndex: (i: number) => void;
  setCurrentTimeMs: (ms: number) => void;
  setIsPlaying: (v: boolean) => void;
  setIsPausedAtStepEnd: (v: boolean) => void;
  setStepProgress: (v: number) => void;
  addChatMessage: (msg: ChatMessage) => void;
  updateLastAssistantMessage: (chunk: string) => void;
  setIsCopilotLoading: (v: boolean) => void;
  setCurrentInstruction: (s: string) => void;
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

  reset: () => set(initialState),
}));
