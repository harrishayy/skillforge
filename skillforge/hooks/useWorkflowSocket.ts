"use client";
import { useEffect, useRef, useCallback } from "react";
import type { PipelineEvent } from "@/types";
import { PIPELINE_WS } from "@/lib/constants";
import { showErrorToast } from "@/store/toast-store";

export function useWorkflowSocket(
  workflowId: string | null,
  onEvent: (event: PipelineEvent) => void
) {
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!workflowId) return;

    const connect = () => {
      const ws = new WebSocket(PIPELINE_WS(workflowId));
      wsRef.current = ws;

      ws.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as PipelineEvent;
          onEventRef.current(event);
        } catch {}
      };

      ws.onclose = (e) => {
        if (e.code !== 1000) {
          showErrorToast("Pipeline connection lost, reconnecting...");
          setTimeout(connect, 2000);
        }
      };
    };

    connect();

    return () => {
      wsRef.current?.close(1000, "component unmounted");
    };
  }, [workflowId]);

  const disconnect = useCallback(() => {
    wsRef.current?.close(1000);
  }, []);

  return { disconnect };
}
