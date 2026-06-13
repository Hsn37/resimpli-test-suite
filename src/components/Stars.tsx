"use client";

import { Star } from "lucide-react";
import { MAX_STARS } from "@/lib/grade";

interface Props {
  value: number;
  size?: number;
  /** When provided the stars are clickable; clicking the active star clears it. */
  onChange?: (value: number) => void;
  /** Tailwind classes for empty stars (display vs. picker use slightly different shades). */
  emptyClass?: string;
}

export default function Stars({
  value,
  size = 16,
  onChange,
  emptyClass = "text-zinc-300 dark:text-zinc-600",
}: Props) {
  const stars = Array.from({ length: MAX_STARS }, (_, i) => i + 1);

  return (
    <div className="inline-grid grid-cols-5 gap-0.5 w-fit">
      {stars.map((star) => {
        const icon = (
          <Star
            size={size}
            className={
              star <= value ? "fill-yellow-400 text-yellow-400" : emptyClass
            }
          />
        );
        return onChange ? (
          <button
            key={star}
            type="button"
            onClick={() => onChange(value === star ? 0 : star)}
            className="transition-colors"
          >
            {icon}
          </button>
        ) : (
          <span key={star}>{icon}</span>
        );
      })}
    </div>
  );
}
