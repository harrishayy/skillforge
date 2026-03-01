"use client";
import { create } from "zustand";

interface ToastItem {
  id: number;
  message: string;
}

interface ToastStore {
  toasts: ToastItem[];
  _nextId: number;
  push: (message: string) => void;
  dismiss: (id: number) => void;
}

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  _nextId: 1,
  push: (message) => {
    const id = get()._nextId;
    set((s) => ({
      _nextId: s._nextId + 1,
      toasts: [...s.toasts, { id, message }],
    }));
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function showErrorToast(error: unknown) {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "An unknown error occurred";
  useToastStore.getState().push(msg);
}

export function showSuccessToast(message: string) {
  useToastStore.getState().push(message);
}
