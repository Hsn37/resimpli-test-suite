"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { FlaskConical, Loader2, Rocket } from "lucide-react";
import {
  DEFAULT_WORKSPACE,
  WORKSPACE_COOKIE,
  WORKSPACES,
  isWorkspace,
  type Workspace,
} from "@/lib/workspace";
import { isAdminEmail } from "@/lib/adminClient";

interface WorkspaceContextValue {
  workspace: Workspace;
  setWorkspace: (next: Workspace) => void;
  isAdmin: boolean;
  isSwitching: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspace: DEFAULT_WORKSPACE,
  setWorkspace: () => {},
  isAdmin: false,
  isSwitching: false,
});

export function useWorkspace() {
  return useContext(WorkspaceContext);
}

// One year — the choice is sticky until the admin switches. Matches the
// server resolver's fallback so a cleared cookie just lands back on dev.
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function readWorkspaceCookie(): Workspace | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${WORKSPACE_COOKIE}=`));
  const value = match?.split("=")[1];
  return isWorkspace(value) ? value : null;
}

function writeWorkspaceCookie(workspace: Workspace): void {
  document.cookie = `${WORKSPACE_COOKIE}=${workspace}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const [isSwitching, startTransition] = useTransition();
  const isAdmin = useMemo(
    () => isAdminEmail(user?.emailAddresses[0]?.emailAddress),
    [user]
  );

  // `null` means "no choice made yet" (admin sees the chooser), distinct from an
  // explicit "dev". Read lazily so it initializes from the cookie on the client
  // without a setState-in-effect; SSR sees null and the client's first render
  // reads the real value.
  const [cookieWorkspace, setCookieWorkspace] = useState<Workspace | null>(
    readWorkspaceCookie
  );

  const setWorkspace = useCallback(
    (next: Workspace) => {
      // Cookie must be written synchronously so the server reads the new value
      // on the refresh below. The transition then spans the server round-trip
      // and client remount, giving consumers a real `isSwitching` pending flag.
      writeWorkspaceCookie(next);
      startTransition(() => {
        setCookieWorkspace(next);
        // Server components / API routes read the cookie per request, so refresh
        // to re-fetch agents/calls under the newly selected workspace.
        router.refresh();
      });
    },
    [router, startTransition]
  );

  // Non-admins are always pinned to dev (DEFAULT_WORKSPACE) — no cookie, no
  // switcher, prod is unreachable for them. Admins use their chosen workspace,
  // falling back to dev until they pick.
  const workspace: Workspace = isAdmin
    ? cookieWorkspace ?? DEFAULT_WORKSPACE
    : DEFAULT_WORKSPACE;

  const value = useMemo(
    () => ({ workspace, setWorkspace, isAdmin, isSwitching }),
    [workspace, setWorkspace, isAdmin, isSwitching]
  );

  // Admin, signed in, hasn't picked a workspace yet → force the chooser first.
  const needsChooser = isLoaded && isAdmin && cookieWorkspace === null;

  return (
    <WorkspaceContext.Provider value={value}>
      {needsChooser ? <WorkspaceChooser onPick={setWorkspace} /> : children}
    </WorkspaceContext.Provider>
  );
}

const WORKSPACE_META: Record<
  Workspace,
  { label: string; blurb: string; icon: typeof Rocket }
> = {
  prod: { label: "Prod", blurb: "Live production data", icon: Rocket },
  dev: { label: "Dev", blurb: "Development sandbox", icon: FlaskConical },
};

// Centered two-button chooser shown to admins on first load. Zinc/blue theme
// to match the rest of the app.
function WorkspaceChooser({ onPick }: { onPick: (w: Workspace) => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-md">
        <h1 className="text-lg font-semibold text-center mb-1">Choose a workspace</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center mb-8">
          You can switch anytime from the sidebar.
        </p>
        <div className="grid grid-cols-2 gap-4">
          {WORKSPACES.map((w) => {
            const meta = WORKSPACE_META[w];
            const Icon = meta.icon;
            return (
              <button
                key={w}
                onClick={() => onPick(w)}
                className="flex flex-col items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
              >
                <Icon size={28} className="text-blue-600 dark:text-blue-400" />
                <span className="font-medium">{meta.label}</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {meta.blurb}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Compact workspace switcher for the sidebar. Renders nothing for non-admins,
 * so the control (and the workspace concept) stays invisible to them.
 */
export function WorkspaceSwitcher({ compact = false }: { compact?: boolean }) {
  const { workspace, setWorkspace, isAdmin, isSwitching } = useWorkspace();
  if (!isAdmin) return null;

  const meta = WORKSPACE_META[workspace];
  const Icon = meta.icon;
  const next: Workspace = workspace === "prod" ? "dev" : "prod";

  if (compact) {
    return (
      <button
        onClick={() => setWorkspace(next)}
        disabled={isSwitching}
        title={`Workspace: ${meta.label} — click to switch to ${WORKSPACE_META[next].label}`}
        className="text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {isSwitching ? <Loader2 size={16} className="animate-spin" /> : <Icon size={16} />}
      </button>
    );
  }

  return (
    <button
      onClick={() => setWorkspace(next)}
      disabled={isSwitching}
      title={`Switch to ${WORKSPACE_META[next].label}`}
      className="flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-xs font-medium hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {isSwitching ? (
        <Loader2 size={13} className="animate-spin text-blue-600 dark:text-blue-400" />
      ) : (
        <Icon size={13} className="text-blue-600 dark:text-blue-400" />
      )}
      {meta.label}
    </button>
  );
}
