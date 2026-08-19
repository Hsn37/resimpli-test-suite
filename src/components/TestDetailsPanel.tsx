import type { TestPreset } from "@/lib/presets";

const PRIORITY_STYLES: Record<string, string> = {
  P0: "bg-red-500/15 text-red-600 dark:text-red-400",
  P1: "bg-amber-500/15 text-amber-600 dark:text-amber-500",
  P2: "bg-zinc-500/15 text-zinc-500 dark:text-zinc-400",
  Obs: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
};

const CHIP = "text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full";

interface Props {
  testCase: TestPreset;
  accentClass: string;
}

/** The "what to say / what to expect" reference card for a selected test
 * case — shown while setting up a call and, unchanged, throughout the live
 * call itself so the tester can keep referring to it. */
export default function TestDetailsPanel({ testCase, accentClass }: Props) {
  return (
    <div className="flex flex-col lg:min-h-0">
      <div className="shrink-0 h-5 flex items-center justify-between gap-2 mb-2.5">
        <span className={`text-xs font-bold uppercase tracking-wide ${accentClass}`}>
          Test Details
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <span className={`${CHIP} font-bold ${PRIORITY_STYLES[testCase.priority] ?? "bg-zinc-200 dark:bg-zinc-800"}`}>
            {testCase.priority}
          </span>
          {testCase.highRisk && (
            <span className={`${CHIP} font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400`}>
              ★ High risk
            </span>
          )}
          <span
            title={`Targets the ${testCase.agentScope} agent`}
            className={`${CHIP} bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300`}
          >
            {testCase.agentScope}
          </span>
        </div>
      </div>
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 shadow-sm p-4 text-sm lg:flex-1 lg:overflow-y-auto lg:min-h-0">
        <div className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
          {testCase.name}
        </div>

        {(testCase.agentConfig === "Variant" || testCase.needsLeadProfile) && (
          <div className="flex flex-wrap gap-1 mb-3">
            {testCase.agentConfig === "Variant" && (
              <span className={`${CHIP} bg-purple-500/15 text-purple-600 dark:text-purple-400`}>
                Variant config
              </span>
            )}
            {testCase.needsLeadProfile && (
              <span className={`${CHIP} bg-teal-500/15 text-teal-600 dark:text-teal-400`}>
                Lead profile staged
              </span>
            )}
          </div>
        )}

        {testCase.setup && (
          <div className="mb-3">
            <div className="text-xs font-bold uppercase tracking-wide mb-0.5 text-amber-600 dark:text-amber-500">
              Setup
            </div>
            <p className="text-zinc-700 dark:text-zinc-300">{testCase.setup}</p>
          </div>
        )}

        <div className="mb-3">
          <div className={`text-xs font-bold uppercase tracking-wide mb-0.5 ${accentClass}`}>
            Expected outcome
          </div>
          <p className="text-zinc-700 dark:text-zinc-300">{testCase.expectedBehavior}</p>
        </div>

        {testCase.sample && (
          <div className="mb-3">
            <div className={`text-xs font-bold uppercase tracking-wide mb-0.5 ${accentClass}`}>
              Agent should say (sample)
            </div>
            <p className="italic text-zinc-600 dark:text-zinc-400 border-l-2 border-zinc-300 dark:border-zinc-700 pl-2">
              {testCase.sample}
            </p>
          </div>
        )}

        {testCase.userMessages.length > 0 && (
          <div className="mb-3">
            <div className={`text-xs font-bold uppercase tracking-wide mb-0.5 ${accentClass}`}>
              What to say, in order
            </div>
            <ol className="list-decimal list-inside space-y-0.5 text-zinc-700 dark:text-zinc-300">
              {testCase.userMessages.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ol>
          </div>
        )}

        {testCase.testerNotes && (
          <div className="mb-3">
            <div className={`text-xs font-bold uppercase tracking-wide mb-0.5 ${accentClass}`}>
              Tester notes
            </div>
            <p className="text-zinc-600 dark:text-zinc-400">{testCase.testerNotes}</p>
          </div>
        )}

        <div>
          <div className={`text-xs font-bold uppercase tracking-wide mb-0.5 ${accentClass}`}>
            Expected path
          </div>
          <p className="font-mono text-xs text-zinc-500 break-words">{testCase.expectedPath}</p>
        </div>
      </div>
    </div>
  );
}
