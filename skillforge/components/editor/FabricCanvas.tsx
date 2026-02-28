"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useCallback } from "react";
import { useWorkflowStore, selectedStep } from "@/store/workflow-store";
import { useEditorStore } from "@/store/editor-store";
import { frameUrl } from "@/lib/constants";
import { createAnnotation, deleteAnnotation } from "@/lib/api-client";
import type { Annotation } from "@/types";

// Dynamic import Fabric to avoid SSR
let fabricPromise: Promise<typeof import("fabric")> | null = null;
const getFabric = () => {
  if (!fabricPromise) fabricPromise = import("fabric");
  return fabricPromise;
};

/** Attach annotation id to fabric objects via a custom property */
function tagObject(obj: any, annotationId: string, type: string) {
  obj._annotationId = annotationId;
  obj._annotationType = type;
}

function getAnnotationId(obj: any): string | undefined {
  return obj?._annotationId;
}

export function FabricCanvas() {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<any | null>(null);
  const isDrawingArrowRef = useRef(false);
  const arrowStartRef = useRef<{ x: number; y: number } | null>(null);
  const tempLineRef = useRef<any | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeColorRef = useRef("#3B82F6");
  const activeToolRef = useRef<string>("select");

  const store = useWorkflowStore();
  const step = selectedStep(store);
  const { activeTool, activeColor } = useEditorStore();
  const { addAnnotationLocal, deleteAnnotationById } = store;

  // Keep refs in sync so event handlers use latest values
  activeColorRef.current = activeColor;
  activeToolRef.current = activeTool;

  // Initialize fabric canvas
  useEffect(() => {
    if (!canvasElRef.current) return;
    let canvas: any;

    getFabric().then(({ Canvas }) => {
      canvas = new Canvas(canvasElRef.current!, {
        width: 960,
        height: 540,
        selection: true,
      });
      fabricRef.current = canvas;
    });

    return () => {
      canvas?.dispose();
      fabricRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadAnnotations = useCallback((annotations: Annotation[]) => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    getFabric().then(({ Rect, Line, Textbox }) => {
      const cw: number = canvas.getWidth();
      const ch: number = canvas.getHeight();

      for (const ann of annotations) {
        if (ann.type === "bounding_box" || ann.type === "highlight") {
          const rect = new Rect({
            left: ((ann.x ?? 0) / 100) * cw,
            top: ((ann.y ?? 0) / 100) * ch,
            width: ((ann.width ?? 10) / 100) * cw,
            height: ((ann.height ?? 10) / 100) * ch,
            fill: ann.type === "highlight" ? ann.color + "33" : "transparent",
            stroke: ann.color,
            strokeWidth: 2,
          });
          tagObject(rect, ann.id, ann.type);
          canvas.add(rect);
        }

        if (ann.type === "arrow") {
          const line = new Line(
            [
              ((ann.from_x ?? 0) / 100) * cw,
              ((ann.from_y ?? 0) / 100) * ch,
              ((ann.to_x ?? 100) / 100) * cw,
              ((ann.to_y ?? 100) / 100) * ch,
            ],
            { stroke: ann.color, strokeWidth: 3 }
          );
          tagObject(line, ann.id, "arrow");
          canvas.add(line);
        }

        if (ann.type === "text_label" && ann.label) {
          const text = new Textbox(ann.label, {
            left: ((ann.x ?? 10) / 100) * cw,
            top: ((ann.y ?? 10) / 100) * ch,
            fill: ann.color,
            fontSize: 18,
            fontWeight: "bold",
          });
          tagObject(text, ann.id, "text_label");
          canvas.add(text);
        }
      }
      canvas.renderAll();
    });
  }, []);

  // Load keyframe + annotations when step changes
  useEffect(() => {
    if (!step || !fabricRef.current) return;
    const canvas = fabricRef.current;
    canvas.clear();

    if (step.key_frame_path) {
      getFabric().then(({ FabricImage }) => {
        FabricImage.fromURL(frameUrl(step.key_frame_path!), {
          crossOrigin: "anonymous",
        }).then((img: any) => {
          img.set({ selectable: false, evented: false });
          img.scaleToWidth(canvas.getWidth());
          canvas.backgroundImage = img;
          loadAnnotations(step.annotations);
          canvas.renderAll();
        });
      });
    } else {
      loadAnnotations(step.annotations);
    }
  }, [step?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mouse event handlers for annotation drawing
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const handleMouseDown = async (opt: any) => {
      const tool = activeToolRef.current;
      const color = activeColorRef.current;
      const currentStep = useWorkflowStore.getState().workflow?.steps.find(
        (s) => s.id === useWorkflowStore.getState().selectedStepId
      );
      if (!currentStep) return;

      const pointer = canvas.getPointer(opt.e);
      const cw: number = canvas.getWidth();
      const ch: number = canvas.getHeight();

      if (tool === "arrow") {
        isDrawingArrowRef.current = true;
        arrowStartRef.current = { x: pointer.x, y: pointer.y };
        return;
      }

      if (tool === "box") {
        const startX = pointer.x;
        const startY = pointer.y;

        getFabric().then(({ Rect }) => {
          const rect = new Rect({
            left: startX,
            top: startY,
            width: 1,
            height: 1,
            fill: "transparent",
            stroke: color,
            strokeWidth: 2,
            selectable: false,
          });
          canvas.add(rect);

          const handleMove = (moveOpt: any) => {
            const p = canvas.getPointer(moveOpt.e);
            rect.set({
              width: Math.abs(p.x - startX),
              height: Math.abs(p.y - startY),
              left: Math.min(startX, p.x),
              top: Math.min(startY, p.y),
            });
            canvas.renderAll();
          };

          const handleUp = async () => {
            canvas.off("mouse:move", handleMove);
            canvas.off("mouse:up", handleUp);
            rect.set({ selectable: true });

            const ann = await createAnnotation(currentStep.id, {
              type: "bounding_box",
              x: ((rect.left ?? 0) / cw) * 100,
              y: ((rect.top ?? 0) / ch) * 100,
              width: ((rect.width ?? 10) / cw) * 100,
              height: ((rect.height ?? 10) / ch) * 100,
              color,
              style: "solid",
            });
            tagObject(rect, ann.id, "bounding_box");
            addAnnotationLocal(currentStep.id, ann);
          };

          canvas.on("mouse:move", handleMove);
          canvas.on("mouse:up", handleUp);
        });
      }

      if (tool === "text") {
        getFabric().then(async ({ Textbox }) => {
          const text = new Textbox("Label", {
            left: pointer.x,
            top: pointer.y,
            fill: color,
            fontSize: 18,
            fontWeight: "bold",
            width: 150,
          });
          canvas.add(text);
          canvas.setActiveObject(text);
          text.enterEditing?.();

          const ann = await createAnnotation(currentStep.id, {
            type: "text_label",
            label: "Label",
            x: (pointer.x / cw) * 100,
            y: (pointer.y / ch) * 100,
            color,
            style: "solid",
          });
          tagObject(text, ann.id, "text_label");
          addAnnotationLocal(currentStep.id, ann);
        });
      }
    };

    const handleMouseMove = (opt: any) => {
      if (!isDrawingArrowRef.current || !arrowStartRef.current) return;
      const pointer = canvas.getPointer(opt.e);
      const color = activeColorRef.current;

      if (tempLineRef.current) canvas.remove(tempLineRef.current);
      getFabric().then(({ Line }) => {
        const line = new Line(
          [arrowStartRef.current!.x, arrowStartRef.current!.y, pointer.x, pointer.y],
          { stroke: color, strokeWidth: 3, selectable: false }
        );
        tempLineRef.current = line;
        canvas.add(line);
        canvas.renderAll();
      });
    };

    const handleMouseUp = async (opt: any) => {
      if (!isDrawingArrowRef.current || !arrowStartRef.current) return;
      const pointer = canvas.getPointer(opt.e);
      const color = activeColorRef.current;
      const start = arrowStartRef.current;
      isDrawingArrowRef.current = false;
      arrowStartRef.current = null;

      if (tempLineRef.current) {
        canvas.remove(tempLineRef.current);
        tempLineRef.current = null;
      }

      const currentStep = useWorkflowStore.getState().workflow?.steps.find(
        (s) => s.id === useWorkflowStore.getState().selectedStepId
      );
      if (!currentStep) return;

      const cw: number = canvas.getWidth();
      const ch: number = canvas.getHeight();

      const ann = await createAnnotation(currentStep.id, {
        type: "arrow",
        from_x: (start.x / cw) * 100,
        from_y: (start.y / ch) * 100,
        to_x: (pointer.x / cw) * 100,
        to_y: (pointer.y / ch) * 100,
        color,
        style: "dashed",
      });
      addAnnotationLocal(currentStep.id, ann);

      getFabric().then(({ Line }) => {
        const line = new Line([start.x, start.y, pointer.x, pointer.y], {
          stroke: color,
          strokeWidth: 3,
        });
        tagObject(line, ann.id, "arrow");
        canvas.add(line);
        canvas.renderAll();
      });
    };

    canvas.on("mouse:down", handleMouseDown);
    canvas.on("mouse:move", handleMouseMove);
    canvas.on("mouse:up", handleMouseUp);

    return () => {
      canvas.off("mouse:down", handleMouseDown);
      canvas.off("mouse:move", handleMouseMove);
      canvas.off("mouse:up", handleMouseUp);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update canvas interactivity when tool changes
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.selection = activeTool === "select";
    canvas.defaultCursor = activeTool === "select" ? "default" : "crosshair";
    canvas.getObjects().forEach((obj: any) => {
      obj.selectable = activeTool === "select";
      obj.evented = activeTool === "select";
    });
    canvas.renderAll();
  }, [activeTool]);

  const handleDeleteSelected = useCallback(async () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active) return;
    const annId = getAnnotationId(active);
    if (annId) {
      canvas.remove(active);
      canvas.renderAll();
      await deleteAnnotationById(annId);
    }
  }, [deleteAnnotationById]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && document.activeElement?.tagName !== "INPUT") {
        handleDeleteSelected();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleDeleteSelected]);

  return (
    <div className="relative border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950">
      <canvas ref={canvasElRef} />
      <div className="absolute bottom-2 right-2 text-xs text-zinc-600">
        {activeTool !== "select" ? `${activeTool} tool active` : "select mode"}
      </div>
    </div>
  );
}
