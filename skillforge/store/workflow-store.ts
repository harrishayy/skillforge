"use client";
import { create } from "zustand";
import type { Workflow, Step, Annotation, Sam3Segment, ApparatusObject } from "@/types";
import {
  updateStep,
  updateAnnotation,
  deleteAnnotation,
  segmentPoint,
  regenerateStep,
  rerunStepPipeline,
  updateApparatusObject,
  rebuildWorkflowMemories,
  getWorkflow,
} from "@/lib/api-client";
import type { RerunPipelineOptions } from "@/lib/api-client";
import { showErrorToast } from "@/store/toast-store";

interface WorkflowStore {
  workflow: Workflow | null;
  selectedStepId: string | null;
  selectedApparatusObjectId: string | null;
  isLoading: boolean;

  // SAM3 segmentation state
  segmentsByStep: Record<string, Sam3Segment[]>;
  segmentPromptByStep: Record<string, string>;
  segmentingStepId: string | null;

  // Regeneration state
  regeneratingStepId: string | null;

  // Pipeline rerun state
  rerunningStepId: string | null;

  // Apparatus memory rebuild state
  rebuildingMemories: boolean;

  // Active filmstrip frame per step
  activeFramePath: Record<string, string>;

  setWorkflow: (wf: Workflow) => void;
  selectStep: (stepId: string | null) => void;
  selectApparatusObject: (objectId: string | null) => void;
  updateStepLocal: (stepId: string, fields: Partial<Step>) => void;
  addAnnotationLocal: (stepId: string, ann: Annotation) => void;
  updateAnnotationLocal: (annId: string, ann: Partial<Annotation>) => void;
  removeAnnotationLocal: (annId: string) => void;
  reorderSteps: (fromIndex: number, toIndex: number) => void;

  // Async actions
  saveStep: (stepId: string, fields: Partial<Step>) => Promise<void>;
  saveAnnotation: (ann: Annotation) => Promise<void>;
  deleteAnnotationById: (annId: string) => Promise<void>;

  // SAM3 segmentation actions
  addSegment: (stepId: string, x: number, y: number, frameTimestampMs: number) => Promise<void>;
  removeSegment: (stepId: string, index: number) => void;
  clearSegments: (stepId: string) => void;
  setSegmentPrompt: (stepId: string, prompt: string) => void;

  // Regeneration
  regenerate: (stepId: string, additionalContext: string) => Promise<void>;

  // Pipeline rerun
  rerunPipeline: (stepId: string, options: RerunPipelineOptions) => Promise<boolean>;

  // Apparatus objects
  updateApparatusObjectLocal: (objectId: string, fields: Partial<ApparatusObject>) => void;
  saveApparatusObject: (objectId: string, fields: Partial<Pick<ApparatusObject, "object_name" | "description" | "visual_cues" | "sam3_prompt">>) => Promise<void>;
  rebuildMemories: () => Promise<void>;

  // Filmstrip
  setActiveFrame: (stepId: string, framePath: string) => void;
}

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  workflow: null,
  selectedStepId: null,
  selectedApparatusObjectId: null,
  isLoading: false,
  segmentsByStep: {},
  segmentPromptByStep: {},
  segmentingStepId: null,
  regeneratingStepId: null,
  rerunningStepId: null,
  rebuildingMemories: false,
  activeFramePath: {},

  setWorkflow: (wf) => set({ workflow: wf }),

  selectStep: (stepId) => set({ selectedStepId: stepId, selectedApparatusObjectId: null }),

  selectApparatusObject: (objectId) => set({ selectedApparatusObjectId: objectId, selectedStepId: null }),

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
    try {
      await updateStep(stepId, fields);
    } catch (e) {
      showErrorToast(e);
    }
  },

  saveAnnotation: async (ann) => {
    get().updateAnnotationLocal(ann.id, ann);
    try {
      await updateAnnotation(ann.id, ann);
    } catch (e) {
      showErrorToast(e);
    }
  },

  deleteAnnotationById: async (annId) => {
    get().removeAnnotationLocal(annId);
    try {
      await deleteAnnotation(annId);
    } catch (e) {
      showErrorToast(e);
    }
  },

  addSegment: async (stepId, x, y, frameTimestampMs) => {
    set({ segmentingStepId: stepId });
    try {
      const result = await segmentPoint(stepId, x, y, frameTimestampMs);
      set((s) => ({
        segmentsByStep: {
          ...s.segmentsByStep,
          [stepId]: [...(s.segmentsByStep[stepId] ?? []), ...result.segments],
        },
        segmentingStepId: null,
      }));
    } catch (e) {
      showErrorToast(e);
      set({ segmentingStepId: null });
    }
  },

  removeSegment: (stepId, index) =>
    set((s) => ({
      segmentsByStep: {
        ...s.segmentsByStep,
        [stepId]: (s.segmentsByStep[stepId] ?? []).filter((_, i) => i !== index),
      },
    })),

  clearSegments: (stepId) =>
    set((s) => ({
      segmentsByStep: { ...s.segmentsByStep, [stepId]: [] },
    })),

  setSegmentPrompt: (stepId, prompt) =>
    set((s) => ({
      segmentPromptByStep: { ...s.segmentPromptByStep, [stepId]: prompt },
    })),

  regenerate: async (stepId, additionalContext) => {
    set({ regeneratingStepId: stepId });
    try {
      const result = await regenerateStep(stepId, additionalContext);
      get().updateStepLocal(stepId, result.step);
      set({ regeneratingStepId: null });
    } catch (e) {
      showErrorToast(e);
      set({ regeneratingStepId: null });
    }
  },

  rerunPipeline: async (stepId, options) => {
    set({ rerunningStepId: stepId });
    try {
      const updatedStep = await rerunStepPipeline(stepId, options);
      get().updateStepLocal(stepId, updatedStep);
      set({ rerunningStepId: null });
      return true;
    } catch (e) {
      showErrorToast(e);
      set({ rerunningStepId: null });
      return false;
    }
  },

  updateApparatusObjectLocal: (objectId, fields) =>
    set((state) => {
      if (!state.workflow?.apparatus_objects) return state;
      return {
        workflow: {
          ...state.workflow,
          apparatus_objects: state.workflow.apparatus_objects.map((obj) =>
            obj.id === objectId ? { ...obj, ...fields } : obj
          ),
        },
      };
    }),

  saveApparatusObject: async (objectId, fields) => {
    get().updateApparatusObjectLocal(objectId, fields);
    try {
      await updateApparatusObject(objectId, fields);
    } catch (e) {
      showErrorToast(e);
    }
  },

  rebuildMemories: async () => {
    const wf = get().workflow;
    if (!wf) return;
    set({ rebuildingMemories: true });
    try {
      await rebuildWorkflowMemories(wf.id);
      const updated = await getWorkflow(wf.id);
      set({ workflow: updated, rebuildingMemories: false });
    } catch (e) {
      showErrorToast(e);
      set({ rebuildingMemories: false });
    }
  },

  setActiveFrame: (stepId, framePath) =>
    set((s) => ({
      activeFramePath: { ...s.activeFramePath, [stepId]: framePath },
    })),
}));

export const selectedStep = (state: { workflow: Workflow | null; selectedStepId: string | null }) =>
  state.workflow?.steps.find((s) => s.id === state.selectedStepId) ?? null;

export const selectedApparatusObject = (state: { workflow: Workflow | null; selectedApparatusObjectId: string | null }) =>
  state.workflow?.apparatus_objects?.find((o) => o.id === state.selectedApparatusObjectId) ?? null;
