"use client";

import { useEffect, useState } from "react";

interface Props {
  running: boolean;
  startTime: number | null;
}

export default function CallTimer({ running, startTime }: Props) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!running || !startTime) {
      return;
    }
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [running, startTime]);

  useEffect(() => {
    if (!running) return;
    setElapsed(0);
  }, [running]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  return (
    <span className="font-mono text-sm tabular-nums text-zinc-500">
      {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
    </span>
  );
}
