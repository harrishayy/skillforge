"use client";
import { create } from "zustand";
import type { Workflow, Step, Sam3Segment, ReviewStepStatus } from "@/types";
import {
  getWorkflow,
  updateStep,
  regenerateStep,
  segmentPoint,
} from "@/lib/api-client";

interface PerStepState {
  status: ReviewStepStatus;
  segments: Sam3Segment[];
  isSegmenting: boolean;
  isRegenerating: boolean;
}

interface ReviewStore {
  workflow: Workflow | null;
  activeStepIndex: number;
  stepStates: Record<string, PerStepState>;
  isLoading: boolean;
  error: string | null;

  loadWorkflow: (workflowId: string) => Promise<void>;
  setActiveStep: (index: number) => void;
  nextStep: () => void;
  prevStep: () => void;

  approveStep: (stepId: string) => void;
  markRefilm: (stepId: string) => void;
  resetStepStatus: (stepId: string) => void;
  allApproved: () => boolean;

  editStepField: (
    stepId: string,
    field: "title" | "description",
    value: string
  ) => Promise<void>;

  regenerate: (stepId: string, additionalContext?: string) => Promise<void>;

  addSegment: (
    stepId: string,
    x: number,
    y: number,
    frameTimestampMs: number
  ) => Promise<void>;
  removeSegment: (stepId: string, index: number) => void;
  clearSegments: (stepId: string) => void;

  replaceStep: (updatedStep: Step) => void;
}

function defaultPerStep(): PerStepState {
  return { status: "pending", segments: [], isSegmenting: false, isRegenerating: false };
}

export const useReviewStore = create<ReviewStore>((set, get) => ({
  workflow: null,
  activeStepIndex: 0,
  stepStates: {},
  isLoading: false,
  error: null,

  loadWorkflow: async (workflowId) => {
    set({ isLoading: true, error: null });
    try {
      const wf = await getWorkflow(workflowId);
      const states: Record<string, PerStepState> = {};
      for (const step of wf.steps) {
        states[step.id] = defaultPerStep();
      }
      set({ workflow: wf, stepStates: states, activeStepIndex: 0, isLoading: false });
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : "Failed to load workflow", isLoading: false });
    }
  },

  setActiveStep: (index) => set({ activeStepIndex: index }),

  nextStep: () => {
    const { workflow, activeStepIndex } = get();
    if (workflow && activeStepIndex < workflow.steps.length - 1) {
      set({ activeStepIndex: activeStepIndex + 1 });
    }
  },

  prevStep: () => {
    const { activeStepIndex } = get();
    if (activeStepIndex > 0) {
      set({ activeStepIndex: activeStepIndex - 1 });
    }
  },

  approveStep: (stepId) =>
    set((s) => ({
      stepStates: {
        ...s.stepStates,
        [stepId]: { ...s.stepStates[stepId], status: "approved" },
      },
    })),

  markRefilm: (stepId) =>
    set((s) => ({
      stepStates: {
        ...s.stepStates,
        [stepId]: { ...s.stepStates[stepId], status: "refilm" },
      },
    })),

  resetStepStatus: (stepId) =>
    set((s) => ({
      stepStates: {
        ...s.stepStates,
        [stepId]: { ...s.stepStates[stepId], status: "pending" },
      },
    })),

  allApproved: () => {
    const { stepStates } = get();
    return Object.values(stepStates).every((s) => s.status === "approved");
  },

  editStepField: async (stepId, field, value) => {
    set((s) => {
      if (!s.workflow) return s;
      return {
        workflow: {
          ...s.workflow,
          steps: s.workflow.steps.map((st) =>
            st.id === stepId ? { ...st, [field]: value } : st
          ),
        },
      };
    });
    await updateStep(stepId, { [field]: value });
  },

  regenerate: async (stepId, additionalContext) => {
    set((s) => ({
      stepStates: {
        ...s.stepStates,
        [stepId]: { ...s.stepStates[stepId], isRegenerating: true },
      },
    }));
    try {
      const result = await regenerateStep(stepId, additionalContext);
      set((s) => {
        if (!s.workflow) return s;
        return {
          workflow: {
            ...s.workflow,
            steps: s.workflow.steps.map((st) =>
              st.id === stepId ? result.step : st
            ),
          },
          stepStates: {
            ...s.stepStates,
            [stepId]: { ...s.stepStates[stepId], isRegenerating: false },
          },
        };
      });
    } catch {
      set((s) => ({
        stepStates: {
          ...s.stepStates,
          [stepId]: { ...s.stepStates[stepId], isRegenerating: false },
        },
      }));
    }
  },

  addSegment: async (stepId, x, y, frameTimestampMs) => {
    set((s) => ({
      stepStates: {
        ...s.stepStates,
        [stepId]: { ...s.stepStates[stepId], isSegmenting: true },
      },
    }));
    try {
      const result = await segmentPoint(stepId, x, y, frameTimestampMs);
      set((s) => ({
        stepStates: {
          ...s.stepStates,
          [stepId]: {
            ...s.stepStates[stepId],
            segments: [...s.stepStates[stepId].segments, ...result.segments],
            isSegmenting: false,
          },
        },
      }));
    } catch {
      set((s) => ({
        stepStates: {
          ...s.stepStates,
          [stepId]: { ...s.stepStates[stepId], isSegmenting: false },
        },
      }));
    }
  },

  removeSegment: (stepId, index) =>
    set((s) => ({
      stepStates: {
        ...s.stepStates,
        [stepId]: {
          ...s.stepStates[stepId],
          segments: s.stepStates[stepId].segments.filter((_, i) => i !== index),
        },
      },
    })),

  clearSegments: (stepId) =>
    set((s) => ({
      stepStates: {
        ...s.stepStates,
        [stepId]: { ...s.stepStates[stepId], segments: [] },
      },
    })),

  replaceStep: (updatedStep) =>
    set((s) => {
      if (!s.workflow) return s;
      const exists = s.workflow.steps.some((st) => st.id === updatedStep.id);
      return {
        workflow: {
          ...s.workflow,
          steps: exists
            ? s.workflow.steps.map((st) => (st.id === updatedStep.id ? updatedStep : st))
            : s.workflow.steps,
        },
        stepStates: {
          ...s.stepStates,
          [updatedStep.id]: s.stepStates[updatedStep.id] ?? defaultPerStep(),
        },
      };
    }),
}));
