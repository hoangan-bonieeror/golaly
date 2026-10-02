"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

export interface Toast {
  id: number;
  text: string;
  tone: "ok" | "error";
}

const Ctx = createContext<{ toasts: Toast[]; toast: (text: string, tone?: Toast["tone"]) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  const value = useMemo(() => ({ toasts, toast }), [toasts, toast]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useToast() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast must be used inside <ToastProvider>");
  return v.toast;
}

export function useToasts() {
  return useContext(Ctx)?.toasts ?? [];
}
