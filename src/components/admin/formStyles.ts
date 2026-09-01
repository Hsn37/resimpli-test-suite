// Shared form-control styles for the admin screens (zinc/blue app theme).
// No width here on purpose. A `w-full` baked into a shared class silently
// overrides any width added at the call site — Tailwind resolves conflicting
// utilities by their order in the generated CSS, not by class-attribute order,
// and `.w-full` is emitted late. Set the width explicitly on every input.
export const INPUT_CLASS =
  "px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm";
export const LABEL_CLASS = "text-xs font-medium text-zinc-500";
export const BUTTON_CLASS =
  "flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50";
export const GHOST_BUTTON_CLASS =
  "flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors";
export const SECTION_TITLE_CLASS =
  "text-xs font-semibold text-zinc-500 uppercase tracking-wide";

// Rows a value textarea needs to show its content without a scrollbar or a
// drag handle. Counts real line breaks as well as wrapped length, so the
// multi-line values (appointment slots) open at a usable size.
export function textareaRows(value: string, max = 8): number {
  const wrapped = Math.ceil(value.length / 80);
  const lines = value.split("\n").length;
  return Math.min(max, Math.max(1, lines, wrapped));
}
