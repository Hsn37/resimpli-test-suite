// The two editable rubric layers. Kept out of "server-only" so the admin route
// and the RubricTab client component share one source of truth for the kind
// discriminator (no magic strings on either side).

export const RUBRIC_KIND = {
  failureClass: "failure_class",
  repDimension: "rep_dimension",
} as const;

export type RubricKind = (typeof RUBRIC_KIND)[keyof typeof RUBRIC_KIND];

export const RUBRIC_KINDS: readonly RubricKind[] = [
  RUBRIC_KIND.failureClass,
  RUBRIC_KIND.repDimension,
] as const;

export function isRubricKind(value: unknown): value is RubricKind {
  return typeof value === "string" && (RUBRIC_KINDS as readonly string[]).includes(value);
}
