"use client";
import { useEffect, useRef } from "react";
import type { Step } from "@/types";
import { getClickTargetsForTime, getContainedVideoRect } from "@/lib/video-utils";
import { frameUrl } from "@/lib/constants";

const ROLE_COLORS: Record<string, { stroke: string; mask: string }> = {
  primary: { stroke: "#10B981", mask: "rgba(16, 185, 129, 0.45)" },
  context: { stroke: "#3B82F6", mask: "rgba(59, 130, 246, 0.35)" },
  warning: { stroke: "#EF4444", mask: "rgba(239, 68, 68, 0.40)" },
};

const ROLE_STYLES: Record<string, { lineWidth: number; dashPattern: number[]; fillAlpha: number }> = {
  primary: { lineWidth: 3, dashPattern: [], fillAlpha: 0.08 },
  context: { lineWidth: 2, dashPattern: [6, 4], fillAlpha: 0.05 },
  warning: { lineWidth: 3, dashPattern: [], fillAlpha: 0.10 },
};

interface StepVideoOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  step: Step;
}

/**
 * Canvas overlay that renders SAM3 segmentation masks and bounding boxes in
 * sync with per-step video playback. Preloads mask PNGs from click_targets,
 * computes the object-contain letterbox offset, and composites masks with
 * role-based coloring on each animation frame.
 */
export function StepVideoOverlay({ videoRef, step }: StepVideoOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const maskCacheRef = useRef<Map<string, ImageBitmap>>(new Map());

  const framesRef = useRef(step.frames ?? []);
  const clickTargetsRef = useRef(step.click_targets ?? []);
  const prevTargetCountRef = useRef(0);

  framesRef.current = step.frames ?? [];
  clickTargetsRef.current = step.click_targets ?? [];

  const targetCount = (step.click_targets ?? []).length;

  useEffect(() => {
    if (targetCount !== prevTargetCountRef.current) {
      const detected = framesRef.current.filter((f) => f.object_detected).length;
      console.log(
        `[StepVideoOverlay] Step "${step.title}" — ${targetCount} click_targets, ` +
        `${detected} detected frames out of ${framesRef.current.length} total`,
      );
      prevTargetCountRef.current = targetCount;
    }
  }, [targetCount, step.title]);

  // Preload mask PNGs for all click_targets that have a mask_path
  useEffect(() => {
    const cache = maskCacheRef.current;
    const targets = step.click_targets ?? [];
    let cancelled = false;

    for (const ct of targets) {
      if (!ct.mask_path || cache.has(ct.id)) continue;

      const url = frameUrl(ct.mask_path);
      fetch(url)
        .then((r) => r.blob())
        .then((blob) => createImageBitmap(blob))
        .then((rawBmp) => {
          if (cancelled) return;
          // Convert to alpha mask: use red channel as alpha
          const oc = document.createElement("canvas");
          oc.width = rawBmp.width;
          oc.height = rawBmp.height;
          const octx = oc.getContext("2d");
          if (!octx) return;
          octx.drawImage(rawBmp, 0, 0);
          const imgData = octx.getImageData(0, 0, oc.width, oc.height);
          const d = imgData.data;
          for (let j = 0; j < d.length; j += 4) d[j + 3] = d[j];
          octx.putImageData(imgData, 0, 0);
          return createImageBitmap(oc);
        })
        .then((alphaBmp) => {
          if (!cancelled && alphaBmp) {
            cache.set(ct.id, alphaBmp);
          }
        })
        .catch(() => {});
    }

    return () => { cancelled = true; };
  }, [step.id, step.click_targets]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let lastVisibleCount = -1;

    const render = (time: number) => {
      const rect = video.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && (canvas.width !== rect.width || canvas.height !== rect.height)) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const vr = getContainedVideoRect(
        video.videoWidth, video.videoHeight,
        canvas.width, canvas.height,
      );

      const currentMs = video.currentTime * 1000;
      const visible = getClickTargetsForTime(
        framesRef.current,
        clickTargetsRef.current,
        currentMs,
      );

      if (visible.length !== lastVisibleCount) {
        if (visible.length > 0 && lastVisibleCount <= 0) {
          console.log(`[StepVideoOverlay] Rendering ${visible.length} SAM3 target(s) at ${Math.round(currentMs)}ms`);
        }
        lastVisibleCount = visible.length;
      }

      if (visible.length > 0) {
        const maskCache = maskCacheRef.current;
        const pulse = 0.5 + 0.5 * Math.sin(time * 0.004);

        for (const ct of visible) {
          const role = ct.role ?? (ct.is_primary ? "primary" : "context");
          const colors = ROLE_COLORS[role] ?? ROLE_COLORS.context;
          const style = ROLE_STYLES[role] ?? ROLE_STYLES.context;

          // Map bbox percentages to the contained video rect
          const x = vr.x + (ct.bbox_x / 100) * vr.width;
          const y = vr.y + (ct.bbox_y / 100) * vr.height;
          const bw = (ct.bbox_width / 100) * vr.width;
          const bh = (ct.bbox_height / 100) * vr.height;

          // Draw mask overlay if available
          const maskBmp = maskCache.get(ct.id);
          if (maskBmp) {
            const offscreen = document.createElement("canvas");
            offscreen.width = canvas.width;
            offscreen.height = canvas.height;
            const offCtx = offscreen.getContext("2d");
            if (offCtx) {
              offCtx.drawImage(maskBmp, vr.x, vr.y, vr.width, vr.height);
              offCtx.globalCompositeOperation = "source-in";
              offCtx.fillStyle = colors.mask;
              offCtx.fillRect(0, 0, offscreen.width, offscreen.height);

              ctx.save();
              ctx.globalAlpha = 0.5 + pulse * 0.2;
              ctx.drawImage(offscreen, 0, 0);
              ctx.restore();
            }
          }

          // Draw bounding box
          ctx.save();
          ctx.strokeStyle = colors.stroke;
          ctx.lineWidth = style.lineWidth + pulse * (role === "primary" ? 2 : 1.5);
          ctx.globalAlpha = (role === "primary" ? 0.7 : 0.6) + pulse * 0.3;
          ctx.setLineDash(style.dashPattern);
          ctx.strokeRect(x, y, bw, bh);

          ctx.fillStyle = colors.stroke;
          ctx.globalAlpha = style.fillAlpha + pulse * 0.06;
          ctx.fillRect(x, y, bw, bh);

          if (ct.element_text) {
            const fontSize = Math.max(11, canvas.width * 0.012);
            ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
            ctx.globalAlpha = 0.9;
            const textW = ctx.measureText(ct.element_text).width;
            const pad = 4;
            ctx.fillStyle = "rgba(0,0,0,0.7)";
            ctx.fillRect(x, y - fontSize - pad * 2, textW + pad * 2, fontSize + pad * 2);
            ctx.fillStyle = colors.stroke;
            ctx.fillText(ct.element_text, x + pad, y - pad);
          }
          ctx.restore();
        }
      }

      rafRef.current = requestAnimationFrame(render);
    };

    console.log(`[StepVideoOverlay] RAF loop started — ${clickTargetsRef.current.length} click_targets available`);
    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, [videoRef]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none z-10"
    />
  );
}
