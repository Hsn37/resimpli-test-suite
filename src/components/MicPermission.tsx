"use client";

import { useEffect, useState } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";

type MicState = "checking" | "granted" | "denied" | "unavailable";

interface Props {
  onGranted: () => void;
}

export default function MicPermission({ onGranted }: Props) {
  const [state, setState] = useState<MicState>("checking");

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("unavailable");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop());
        setState("granted");
      })
      .catch(() => {
        setState("denied");
      });
  }, []);

  useEffect(() => {
    if (state === "granted") {
      const timer = setTimeout(onGranted, 500);
      return () => clearTimeout(timer);
    }
  }, [state, onGranted]);

  function retry() {
    setState("checking");
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop());
        setState("granted");
      })
      .catch(() => setState("denied"));
  }

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      {state === "checking" && (
        <>
          <Loader2 size={48} className="animate-spin text-blue-500" />
          <p className="text-zinc-500">Requesting microphone access...</p>
        </>
      )}
      {state === "granted" && (
        <>
          <Mic size={48} className="text-green-500" />
          <p className="text-green-600 font-medium">Microphone access granted</p>
        </>
      )}
      {state === "denied" && (
        <>
          <MicOff size={48} className="text-red-500" />
          <p className="text-red-600 font-medium">Microphone access denied</p>
          <p className="text-sm text-zinc-500 max-w-xs">
            Please allow microphone access in your browser settings, then try
            again.
          </p>
          <button
            onClick={retry}
            className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors"
          >
            Try Again
          </button>
        </>
      )}
      {state === "unavailable" && (
        <>
          <MicOff size={48} className="text-zinc-400" />
          <p className="text-zinc-500">
            Microphone is not available on this device or browser.
          </p>
        </>
      )}
    </div>
  );
}
