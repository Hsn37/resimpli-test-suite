"use client";

import { useEffect, useState, useCallback, createContext, useContext } from "react";
import { X } from "lucide-react";

interface ToastItem {
  id: number;
  message: string;
  type: "error" | "success" | "info";
}

interface ToastContextType {
  toast: (message: string, type?: "error" | "success" | "info") => void;
}

const ToastContext = createContext<ToastContextType>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback(
    (message: string, type: "error" | "success" | "info" = "info") => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, message, type }]);
    },
    []
  );

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <ToastBanner key={t.id} item={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastBanner({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(item.id), 5000);
    return () => clearTimeout(timer);
  }, [item.id, onDismiss]);

  const bg =
    item.type === "error"
      ? "bg-red-600"
      : item.type === "success"
        ? "bg-green-600"
        : "bg-zinc-800";

  return (
    <div
      className={`${bg} text-white px-4 py-3 rounded-lg shadow-lg flex items-start gap-2 animate-slide-in`}
    >
      <span className="flex-1 text-sm">{item.message}</span>
      <button
        onClick={() => onDismiss(item.id)}
        className="shrink-0 hover:opacity-70"
      >
        <X size={16} />
      </button>
    </div>
  );
}
