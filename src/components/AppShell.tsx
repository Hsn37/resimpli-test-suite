"use client";

import { useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton, useUser } from "@clerk/nextjs";
import {
  BarChart3,
  PhoneCall,
  History,
  FlaskConical,
  Settings,
  Menu,
  X,
} from "lucide-react";
import { WorkspaceSwitcher, useWorkspace } from "@/components/WorkspaceProvider";
import { isAdminEmail } from "@/lib/adminClient";

const APP_TITLE = "ReSimpli Test Suite";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  adminOnly?: boolean;
}

// Nav order per spec. Admin tab is gated below via isAdminEmail.
const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/test", label: "Test Call", icon: PhoneCall },
  { href: "/calls", label: "Calls", icon: History },
  { href: "/batch-tests", label: "Batch Tests", icon: FlaskConical },
  { href: "/admin", label: "Admin", icon: Settings, adminOnly: true },
];

// A nav item is active for its exact route or any nested route (e.g.
// /dashboard/calls/[id] keeps Dashboard highlighted).
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user } = useUser();
  const isAdmin = useMemo(
    () => isAdminEmail(user?.emailAddresses[0]?.emailAddress),
    [user]
  );

  return (
    <nav className="flex flex-col gap-1">
      {NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin).map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-blue-600 text-white"
                : "text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900"
            }`}
          >
            <Icon size={16} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

// Shared header row (title + workspace switcher). Reused by the desktop sidebar
// and the mobile drawer so the branding stays consistent. `action` renders on
// the far right (the desktop sidebar passes the profile/logout button here).
function SidebarHeader({ action }: { action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-1">
      <div className="flex items-center gap-2">
        <h1 className="font-semibold text-sm">{APP_TITLE}</h1>
        {action && <div className="ml-auto shrink-0">{action}</div>}
      </div>
      <WorkspaceSwitcher />
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { workspace } = useWorkspace();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Close the drawer on any route change (incl. browser back/forward) by
  // adjusting state during render off the pathname — the React-recommended
  // pattern, avoiding a setState-in-effect.
  const [drawerPath, setDrawerPath] = useState(pathname);
  if (pathname !== drawerPath) {
    setDrawerPath(pathname);
    setDrawerOpen(false);
  }

  return (
    // Pin the shell to the viewport height (dvh handles mobile browser chrome)
    // so the sidebar and page frame stay static and <main> is the sole vertical
    // scroll container. Without a bounded height here, tall pages grow <body>
    // (min-h-full) and the whole window scrolls, dragging the sidebar with it.
    <div className="flex h-dvh min-h-0">
      {/* Desktop sidebar (fixed) */}
      <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800 p-4 overflow-y-auto">
        <div className="flex flex-col gap-6">
          <SidebarHeader action={<UserButton />} />
          <NavLinks />
        </div>
      </aside>

      {/* Mobile top bar with hamburger */}
      <div className="md:hidden fixed top-0 inset-x-0 z-30 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 h-14">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <span className="font-semibold text-sm">{APP_TITLE}</span>
        </div>
        <div className="flex items-center gap-2">
          <WorkspaceSwitcher compact />
          <UserButton />
        </div>
      </div>

      {/* Mobile drawer + backdrop */}
      <div
        className={`md:hidden fixed inset-0 z-40 transition-opacity duration-200 ${
          drawerOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <div
          className="absolute inset-0 bg-black/40"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
        <aside
          className={`absolute top-0 left-0 h-full w-64 bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 p-4 flex flex-col gap-6 transition-transform duration-200 ${
            drawerOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between">
            <SidebarHeader />
            <button
              onClick={() => setDrawerOpen(false)}
              className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
          </div>
          <NavLinks onNavigate={() => setDrawerOpen(false)} />
        </aside>
      </div>

      {/* Main content. key={workspace} remounts client subtrees so they refetch
          when the workspace switches. pt-14 clears the fixed mobile top bar. */}
      <main
        key={workspace}
        className="flex-1 min-w-0 overflow-y-auto pt-14 md:pt-0"
      >
        {children}
      </main>
    </div>
  );
}
