"use client";
import { useRef, useCallback } from "react";
import type { RecordedInputEvent } from "@/types";

export function useInputLogger() {
  const startTimeRef = useRef<number>(0);
  const eventsRef = useRef<RecordedInputEvent[]>([]);
  const isLoggingRef = useRef(false);

  const handleClick = useCallback((e: MouseEvent) => {
    if (!isLoggingRef.current) return;
    const target = e.target as HTMLElement;
    eventsRef.current.push({
      event_type: "click",
      timestamp_ms: Date.now() - startTimeRef.current,
      x: e.clientX,
      y: e.clientY,
      button: e.button === 0 ? "left" : e.button === 2 ? "right" : "middle",
      element_text: target.textContent?.trim().slice(0, 50) ?? undefined,
      element_selector: target.tagName.toLowerCase(),
    });
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isLoggingRef.current) return;
    eventsRef.current.push({
      event_type: "keypress",
      timestamp_ms: Date.now() - startTimeRef.current,
      key: e.key,
    });
  }, []);

  const handleWheel = useCallback((e: WheelEvent) => {
    if (!isLoggingRef.current) return;
    eventsRef.current.push({
      event_type: "scroll",
      timestamp_ms: Date.now() - startTimeRef.current,
      x: e.clientX,
      y: e.clientY,
      scroll_delta: e.deltaY,
    });
  }, []);

  const startLogging = useCallback(() => {
    eventsRef.current = [];
    startTimeRef.current = Date.now();
    isLoggingRef.current = true;
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("wheel", handleWheel, { passive: true });
  }, [handleClick, handleKeyDown, handleWheel]);

  const stopLogging = useCallback((): RecordedInputEvent[] => {
    isLoggingRef.current = false;
    document.removeEventListener("click", handleClick);
    document.removeEventListener("keydown", handleKeyDown);
    document.removeEventListener("wheel", handleWheel);
    return [...eventsRef.current];
  }, [handleClick, handleKeyDown, handleWheel]);

  return { startLogging, stopLogging };
}
