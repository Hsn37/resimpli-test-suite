// Shared, framework-agnostic helpers for turning a 0-100 `call_grades` row into
// the compact fields the /calls + dashboard tables render. Pure (no DB / no
// "server-only"), so both API routes and client components import the same
// logic — one source of truth for the AI-note wording and the row score fields.

// The minimal grade shape these helpers read. `CallGrade` (db.ts) and the
// dashboard's `call_grades` both satisfy it structurally.
export interface GradeLike {
  grade: number | null;
  rep_score: number | null;
  applicable_count: number;
  passed_count: number;
  results: Record<string, unknown>;
  ai_callout: boolean;
  ai_callout_quote: string | null;
}

// Default AI-note copy when a caller-suspected-AI callout carries no quote.
export const DEFAULT_CALLOUT_NOTE = "Caller suspected AI";

/**
 * Human-readable one-line AI note from a full call_grades row:
 *   1. AI callout → its quote (or a short default),
 *   2. else the first applicable-but-failed class by its display name,
 *   3. else a compact "Passed X/Y checks" summary.
 * `classNames` maps failure-class key → display name.
 */
export function humanAiNote(
  grade: GradeLike,
  classNames: Map<string, string>
): string {
  if (grade.ai_callout) {
    return grade.ai_callout_quote?.trim() || DEFAULT_CALLOUT_NOTE;
  }
  const failed = Object.entries(grade.results ?? {}).find(([, r]) => {
    const rr = r as { applicable?: boolean; passed?: boolean };
    return rr?.applicable && !rr?.passed;
  });
  if (failed) {
    const [key] = failed;
    return `Top issue: ${classNames.get(key) ?? key}`;
  }
  return `Passed ${grade.passed_count}/${grade.applicable_count} checks`;
}

// The grade-derived fields a calls-table row consumes. `call_grades` carries the
// full row for the rich modal breakdown; the rest drive the inline chips + note.
export interface CallRowGrade {
  rep_score: number | null;
  grade100: number | null;
  ai_callout: boolean;
  ai_note: string | null;
  call_grades: GradeLike;
}

/** Project a full call_grades row into the row fields the calls table renders. */
export function toCallRowGrade(
  grade: GradeLike,
  classNames: Map<string, string>
): CallRowGrade {
  return {
    rep_score: grade.rep_score ?? null,
    grade100: grade.grade ?? null,
    ai_callout: grade.ai_callout ?? false,
    ai_note: humanAiNote(grade, classNames),
    call_grades: grade,
  };
}
