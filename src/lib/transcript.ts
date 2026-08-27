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

// --- Tool-call timeline -----------------------------------------------
// Retell's `transcript_with_tool_calls` is a single chronological array
// mixing speech turns and tool-call events for a real (non-simulated) call —
// confirmed against live get-call/list-calls responses. Verbatim field names,
// not guessed: `role` is "agent" | "user" | "tool_call_invocation" |
// "tool_call_result"; `arguments` and `content` on tool entries are
// JSON-encoded strings, not objects.

interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

interface ToolTimelineSpeechEntry {
  role: "agent" | "user";
  content: string;
  words?: TranscriptWord[];
}

interface ToolTimelineInvocation {
  role: "tool_call_invocation";
  tool_call_id: string;
  name: string;
  arguments: string;
  time_sec: number;
  type?: string;
}

interface ToolTimelineResult {
  role: "tool_call_result";
  tool_call_id: string;
  successful?: boolean;
  content: string;
  time_sec: number;
}

export type ToolTimelineEntry =
  | ToolTimelineSpeechEntry
  | ToolTimelineInvocation
  | ToolTimelineResult;

/** Retell's separate `tool_calls` summary array — carries per-call latency,
 * which transcript_with_tool_calls does not. */
export interface ToolCallSummary {
  tool_call_id: string;
  name: string;
  type?: string;
  start_time_sec: number;
  latency_ms: number;
  success: boolean;
}

/** One tool call, fully resolved from a matched invocation+result pair. */
export interface ResolvedToolCall {
  toolCallId: string;
  name: string;
  type?: string;
  timeSec: number;
  args: unknown;
  output: unknown;
  /** Null when no matching result was found (e.g. the call ended mid-tool-call). */
  successful: boolean | null;
  /** Null when the summary array didn't carry this tool_call_id. */
  latencyMs: number | null;
}

export type TimelineItem =
  | { kind: "speech"; entry: ToolTimelineSpeechEntry }
  | { kind: "tool"; call: ResolvedToolCall };

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Resolves a raw transcript_with_tool_calls array into a display-ready list:
 * speech turns pass through unchanged, and each tool_call_invocation is
 * merged with its matching tool_call_result (by tool_call_id) into one
 * ResolvedToolCall at the invocation's position. A standalone result (its
 * invocation not in this array) is dropped rather than shown as an orphan —
 * Retell's own array is always invocation-then-result in practice.
 */
export function resolveToolTimeline(
  entries: ToolTimelineEntry[],
  summary: ToolCallSummary[] = []
): TimelineItem[] {
  const latencyById = new Map(summary.map((s) => [s.tool_call_id, s.latency_ms]));
  const resultById = new Map<string, ToolTimelineResult>();
  for (const e of entries) {
    if (e.role === "tool_call_result") resultById.set(e.tool_call_id, e);
  }

  const items: TimelineItem[] = [];
  for (const e of entries) {
    if (e.role === "agent" || e.role === "user") {
      items.push({ kind: "speech", entry: e });
    } else if (e.role === "tool_call_invocation") {
      const result = resultById.get(e.tool_call_id);
      items.push({
        kind: "tool",
        call: {
          toolCallId: e.tool_call_id,
          name: e.name,
          type: e.type,
          timeSec: e.time_sec,
          args: tryParseJson(e.arguments),
          output: result ? tryParseJson(result.content) : null,
          successful: result?.successful ?? null,
          latencyMs: latencyById.get(e.tool_call_id) ?? null,
        },
      });
    }
    // tool_call_result entries are skipped standalone — already merged above.
  }
  return items;
}
