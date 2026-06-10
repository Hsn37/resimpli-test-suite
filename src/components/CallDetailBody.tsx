"use client";

export type CallDetailTab =
  | "transcript"
  | "tools"
  | "analysis"
  | "variables"
  | "raw";

export const CALL_DETAIL_TABS: { key: CallDetailTab; label: string }[] = [
  { key: "transcript", label: "Transcript" },
  { key: "tools", label: "Tool Calls" },
  { key: "analysis", label: "Analysis" },
  { key: "variables", label: "Variables" },
  { key: "raw", label: "Raw JSON" },
];

function KeyValueList({ entries }: { entries: [string, unknown][] }) {
  return (
    <div className="space-y-2">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="flex gap-3 py-1.5 border-b border-zinc-100 dark:border-zinc-900 last:border-0"
        >
          <span className="text-xs font-mono font-semibold text-zinc-600 dark:text-zinc-400 w-[180px] shrink-0 break-all">
            {key}
          </span>
          <span className="text-sm text-zinc-800 dark:text-zinc-200 min-w-0 break-all">
            {typeof value === "string" ? value : JSON.stringify(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Renders the body for the active call-detail tab. Shared by the CallViewer
 * modal and the public /share/[id] page so the two stay in sync.
 */
export default function CallDetailBody({
  data,
  tab,
}: {
  data: Record<string, unknown>;
  tab: CallDetailTab;
}) {
  const transcript = (data.transcript as string) || "";
  const transcriptObj = data.transcript_object as
    | Array<{ role: string; content: string }>
    | undefined;
  const toolCalls = (data.tool_calls ?? data.tool_call_result) as
    | Array<Record<string, unknown>>
    | undefined;
  const analysis = data.call_analysis as Record<string, unknown> | undefined;
  const variables = data.retell_llm_dynamic_variables as
    | Record<string, unknown>
    | undefined;

  if (tab === "transcript") {
    return (
      <div className="space-y-3">
        {transcriptObj && transcriptObj.length > 0 ? (
          transcriptObj.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "agent" ? "justify-start" : "justify-end"}`}
            >
              <div
                className={`max-w-[80%] px-3 py-2 rounded-lg text-sm break-words ${
                  msg.role === "agent"
                    ? "bg-zinc-100 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200"
                    : "bg-blue-600 text-white"
                }`}
              >
                <div className="text-[10px] font-semibold uppercase mb-0.5 opacity-60">
                  {msg.role}
                </div>
                {msg.content}
              </div>
            </div>
          ))
        ) : transcript ? (
          <pre className="text-sm whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
            {transcript}
          </pre>
        ) : (
          <p className="text-sm text-zinc-500">No transcript available.</p>
        )}
      </div>
    );
  }

  if (tab === "tools") {
    return (
      <div className="space-y-3">
        {toolCalls && toolCalls.length > 0 ? (
          toolCalls.map((tc, i) => (
            <div
              key={i}
              className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-3"
            >
              <pre className="text-xs font-mono whitespace-pre-wrap text-zinc-700 dark:text-zinc-300 overflow-x-auto">
                {JSON.stringify(tc, null, 2)}
              </pre>
            </div>
          ))
        ) : (
          <p className="text-sm text-zinc-500">No tool calls recorded.</p>
        )}
      </div>
    );
  }

  if (tab === "analysis") {
    return analysis && Object.keys(analysis).length > 0 ? (
      <KeyValueList entries={Object.entries(analysis)} />
    ) : (
      <p className="text-sm text-zinc-500">No analysis available.</p>
    );
  }

  if (tab === "variables") {
    return variables && Object.keys(variables).length > 0 ? (
      <KeyValueList entries={Object.entries(variables)} />
    ) : (
      <p className="text-sm text-zinc-500">No dynamic variables available.</p>
    );
  }

  return (
    <pre className="text-xs font-mono whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-900 rounded-lg p-4 overflow-x-auto">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
