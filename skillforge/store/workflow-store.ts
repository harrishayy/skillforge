"use client";
import { create } from "zustand";
import type { Workflow, Step, Annotation } from "@/types";
import { updateStep, updateAnnotation, deleteAnnotation } from "@/lib/api-client";

interface WorkflowStore {
  workflow: Workflow | null;
  selectedStepId: string | null;
  isLoading: boolean;

  setWorkflow: (wf: Workflow) => void;
  selectStep: (stepId: string | null) => void;
  updateStepLocal: (stepId: string, fields: Partial<Step>) => void;
  addAnnotationLocal: (stepId: string, ann: Annotation) => void;
  updateAnnotationLocal: (annId: string, ann: Partial<Annotation>) => void;
  removeAnnotationLocal: (annId: string) => void;
  reorderSteps: (fromIndex: number, toIndex: number) => void;

  // Async actions
  saveStep: (stepId: string, fields: Partial<Step>) => Promise<void>;
  saveAnnotation: (ann: Annotation) => Promise<void>;
  deleteAnnotationById: (annId: string) => Promise<void>;
}

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  workflow: null,
  selectedStepId: null,
  isLoading: false,

  setWorkflow: (wf) => set({ workflow: wf }),

  selectStep: (stepId) => set({ selectedStepId: stepId }),

  updateStepLocal: (stepId, fields) =>
    set((state) => {
      if (!state.workflow) return state;
      return {
        workflow: {
          ...state.workflow,
          steps: state.workflow.steps.map((s) =>
            s.id === stepId ? { ...s, ...fields } : s
          ),
        },
      };
    }),

  addAnnotationLocal: (stepId, ann) =>
    set((state) => {
      if (!state.workflow) return state;
      return {
        workflow: {
          ...state.workflow,
          steps: state.workflow.steps.map((s) =>
            s.id === stepId
              ? { ...s, annotations: [...s.annotations, ann] }
              : s
          ),
        },
      };
    }),

  updateAnnotationLocal: (annId, fields) =>
    set((state) => {
      if (!state.workflow) return state;
      return {
        workflow: {
          ...state.workflow,
          steps: state.workflow.steps.map((s) => ({
            ...s,
            annotations: s.annotations.map((a) =>
              a.id === annId ? { ...a, ...fields } : a
            ),
          })),
        },
      };
    }),

  removeAnnotationLocal: (annId) =>
    set((state) => {
      if (!state.workflow) return state;
      return {
        workflow: {
          ...state.workflow,
          steps: state.workflow.steps.map((s) => ({
            ...s,
            annotations: s.annotations.filter((a) => a.id !== annId),
          })),
        },
      };
    }),

  reorderSteps: (fromIndex, toIndex) =>
    set((state) => {
      if (!state.workflow) return state;
      const steps = [...state.workflow.steps];
      const [moved] = steps.splice(fromIndex, 1);
      steps.splice(toIndex, 0, moved);
      return {
        workflow: {
          ...state.workflow,
          steps: steps.map((s, i) => ({ ...s, step_number: i + 1 })),
        },
      };
    }),

  saveStep: async (stepId, fields) => {
    get().updateStepLocal(stepId, fields);
    await updateStep(stepId, fields);
  },

  saveAnnotation: async (ann) => {
    get().updateAnnotationLocal(ann.id, ann);
    await updateAnnotation(ann.id, ann);
  },

  deleteAnnotationById: async (annId) => {
    get().removeAnnotationLocal(annId);
    await deleteAnnotation(annId);
  },
}));

export const selectedStep = (state: { workflow: Workflow | null; selectedStepId: string | null }) =>
  state.workflow?.steps.find((s) => s.id === state.selectedStepId) ?? null;
