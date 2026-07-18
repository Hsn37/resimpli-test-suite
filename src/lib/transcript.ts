// Server-safe home for the shared transcript-turn shape. Deliberately a plain
// types module (no "use client", no "server-only") so it can be imported from
// BOTH client components (TranscriptView / TestRunDetailModal) and server libs
// (grading.ts, grader.ts) + API routes without dragging a client component into
// a node/tsx runtime. Previously this type lived in the "use client"
// TranscriptView component, which made grading.ts/ingestionJobs.ts transitively
// import a client module and crash under plain node.

/** A single {role, content} turn in a rendered/graded transcript. */
export interface TranscriptTurn {
  role: string;
  content: string;
}
