// Star rating scale and conversion to the sheet's "out of 10" score.
// Shared by client (UI) and server (sheet logging) so the relationship
// lives in exactly one place.

export const MAX_STARS = 5;
export const SCORE_MAX = 10;

/** Convert a 1..MAX_STARS grade to a "N/10" string. Empty string when ungraded. */
export function gradeToScore(grade?: number): string {
  if (!grade) return "";
  return `${grade * (SCORE_MAX / MAX_STARS)}/${SCORE_MAX}`;
}
