// Star rating scale and conversion to a score out of 10. The UI works in
// whole stars (1..MAX_STARS); the DB stores the score out of SCORE_MAX
// (mirroring how it was stored in the old Google Sheet, e.g. 4 stars -> 8/10).
export const MAX_STARS = 5;
export const SCORE_MAX = 10;

/** Convert a 1..MAX_STARS star rating to a score out of SCORE_MAX. */
export function starsToScore(stars?: number | null): number | null {
  if (!stars) return null;
  return (stars * SCORE_MAX) / MAX_STARS;
}

/** Convert a stored score out of SCORE_MAX back to a 1..MAX_STARS star count. */
export function scoreToStars(score?: number | null): number {
  if (!score) return 0;
  return Math.round((score * MAX_STARS) / SCORE_MAX);
}
