"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { sharePath } from "@/components/CallsTable";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { CALL_ID_RE, searchCall, type CallSearchHit } from "@/lib/callSearch";
import {
  DEFAULT_WORKSPACE,
  WORKSPACES,
  WORKSPACE_META,
} from "@/lib/workspace";

export default function CallSearchPage() {
  const router = useRouter();
  const { isAdmin } = useWorkspace();
  const [callId, setCallId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hit, setHit] = useState<CallSearchHit | null>(null);

  const query = callId.trim();
  const isValidId = CALL_ID_RE.test(query);

  // Mirrors getAuthorizedWorkspaces() on the server — shown so it's obvious
  // up front how wide the search reaches (all accounts for an admin, the dev
  // sandbox alone for everyone else).
  const scope = isAdmin ? WORKSPACES : [DEFAULT_WORKSPACE];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidId || busy) return;
    setBusy(true);
    setError(null);
    setHit(null);
    try {
      const found = await searchCall(query);
      setHit(found);
      // Straight into the existing call page, with the owning workspace in the
      // link so it resolves against that account no matter which workspace this
      // session is currently on. `busy` stays true through the navigation.
      router.push(sharePath(found.call_id, found.workspace));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to search for call");
      setBusy(false);
    }
  }

  return (
    <div className="w-full p-6 lg:p-8">
      <div className="w-full max-w-xl mx-auto">
        <h1 className="font-semibold text-lg flex items-center gap-2">
          <Search size={18} />
          Call Search
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          Paste a Retell call ID to find it across{" "}
          {scope.map((w) => WORKSPACE_META[w].label).join(", ")}.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-wrap gap-2">
          <input
            type="text"
            value={callId}
            onChange={(e) => {
              setCallId(e.target.value);
              setError(null);
            }}
            placeholder="call_..."
            autoFocus
            spellCheck={false}
            className="flex-1 min-w-[220px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-zinc-400"
          />
          <button
            type="submit"
            disabled={!isValidId || busy}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Search size={15} />
            )}
            Search
          </button>
        </form>

        {query && !isValidId && (
          <p className="mt-3 text-xs text-zinc-400">
            A Retell call ID looks like <span className="font-mono">call_abc123…</span>
          </p>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {hit && (
          <div className="mt-4 rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400 flex items-center gap-2">
            <Loader2 size={14} className="animate-spin text-zinc-400 shrink-0" />
            <span>
              Found in{" "}
              <span className="font-medium text-blue-600 dark:text-blue-400">
                {WORKSPACE_META[hit.workspace].label}
              </span>
              {hit.agent_name ? ` · ${hit.agent_name}` : ""} — opening the call…
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
