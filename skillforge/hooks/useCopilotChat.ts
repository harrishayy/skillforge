"use client";
import { useCallback } from "react";
import { API_BASE } from "@/lib/constants";
import { usePlayerStore } from "@/store/player-store";
import type { ChatMessage } from "@/types";

export function useCopilotChat(workflowId: string, stepId: string) {
  const { chatHistory, addChatMessage, updateLastAssistantMessage, setIsCopilotLoading } =
    usePlayerStore();

  const sendMessage = useCallback(
    async (message: string) => {
      const userMsg: ChatMessage = {
        role: "user",
        content: message,
        timestamp: Date.now(),
      };
      addChatMessage(userMsg);
      setIsCopilotLoading(true);

      // Prepare history in API format (exclude the message we just added)
      const history = chatHistory.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      try {
        const res = await fetch(`${API_BASE}/api/copilot/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workflow_id: workflowId,
            step_id: stepId,
            message,
            chat_history: history,
          }),
        });

        if (!res.body) throw new Error("No response body");

        // Add empty assistant message placeholder
        addChatMessage({ role: "assistant", content: "", timestamp: Date.now() });

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.token) updateLastAssistantMessage(data.token);
              if (data.done) break;
            } catch {}
          }
        }
      } catch (err) {
        addChatMessage({
          role: "assistant",
          content: "Sorry, I encountered an error. Please try again.",
          timestamp: Date.now(),
        });
      } finally {
        setIsCopilotLoading(false);
      }
    },
    [workflowId, stepId, chatHistory, addChatMessage, updateLastAssistantMessage, setIsCopilotLoading]
  );

  return { sendMessage };
}
