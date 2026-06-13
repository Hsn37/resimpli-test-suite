// Star rating scale and conversion to a score out of 10. The UI shows
// MAX_STARS stars (laid out as two rows of five) and the DB stores the score
// out of SCORE_MAX. With MAX_STARS === SCORE_MAX the mapping is 1:1; the
// conversion is kept as functions so the two scales can diverge later.
export const MAX_STARS = 10;
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
