"use client";

import { forwardRef } from "react";

interface CameraFeedProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
  /** Labels shown as pill badges in top-right */
  modeBadges?: Array<{ label: string; color: string }>;
  /** Bottom info text */
  footer?: React.ReactNode;
  className?: string;
}

/**
 * Reusable camera feed with overlay canvas, LIVE badge, and mode badges.
 * The video element is always rendered; show/hide via the parent's isActive state.
 */
export const CameraFeed = forwardRef<HTMLDivElement, CameraFeedProps>(
  ({ videoRef, canvasRef, modeBadges, footer, className }, ref) => {
    return (
      <div ref={ref} className={className}>
        {/* Video + canvas stack */}
        <div className="relative rounded-2xl overflow-hidden bg-black aspect-video shadow-2xl shadow-black/50">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          {canvasRef && (
            <canvas
              ref={canvasRef as React.RefObject<HTMLCanvasElement>}
              className="absolute inset-0 w-full h-full pointer-events-none"
            />
          )}

          {/* LIVE badge */}
          <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/60 rounded-full px-2.5 py-1 text-xs text-white">
            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
            LIVE
          </div>

          {/* Mode badges */}
          {modeBadges && modeBadges.length > 0 && (
            <div className="absolute top-3 right-3 flex gap-1.5 flex-wrap justify-end">
              {modeBadges.map((b) => (
                <span
                  key={b.label}
                  className="text-white text-xs px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: b.color }}
                >
                  {b.label}
                </span>
              ))}
            </div>
          )}
        </div>

        {footer && <div className="mt-4">{footer}</div>}
      </div>
    );
  }
);

CameraFeed.displayName = "CameraFeed";
