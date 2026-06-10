"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";

interface Props {
  src: string;
  onEnded?: () => void;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function AudioPlayer({ src, onEnded }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    // Attempt autoplay; the actual `playing` state is driven by the
    // onPlay/onPause events so a blocked autoplay doesn't desync the UI.
    audio.play().catch(() => {});
  }, [src]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }

  function toggleMute() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setMuted(audio.muted);
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    if (!audio) return;
    const time = Number(e.target.value);
    audio.currentTime = time;
    setCurrentTime(time);
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-3 rounded-lg bg-white dark:bg-zinc-900 border border-blue-200 dark:border-blue-900 px-3 py-2">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          onEnded?.();
        }}
        className="hidden"
      />
      <button
        onClick={togglePlay}
        className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700 transition-colors"
      >
        {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </button>

      <span className="text-xs font-mono text-zinc-500 w-10 text-right shrink-0 tabular-nums">
        {formatTime(currentTime)}
      </span>

      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.01}
        value={currentTime}
        onChange={handleSeek}
        className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer accent-blue-600 bg-zinc-200 dark:bg-zinc-700"
        style={{
          background: `linear-gradient(to right, rgb(37 99 235) ${progress}%, var(--track-bg, #e4e4e7) ${progress}%)`,
        }}
      />

      <span className="text-xs font-mono text-zinc-500 w-10 shrink-0 tabular-nums">
        {formatTime(duration)}
      </span>

      <button
        onClick={toggleMute}
        className="shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
      >
        {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
      </button>
    </div>
  );
}
