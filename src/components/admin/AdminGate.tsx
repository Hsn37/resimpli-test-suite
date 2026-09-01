"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { Loader2, Shield } from "lucide-react";
import Link from "next/link";
import { isAdminEmail } from "@/lib/adminClient";

/**
 * Client-side admin gate shared by every admin page. Server-authoritative:
 * a 200 from an admin route means admin, and the env allowlist is only the
 * fallback when that probe fails. This is a UX gate — each admin API route
 * still enforces requireAdmin(), which is the real boundary.
 */
export default function AdminGate({ children }: { children: React.ReactNode }) {
  const { user, isLoaded } = useUser();
  // null = still probing.
  const [isAdminUser, setIsAdminUser] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    const email = user?.emailAddresses[0]?.emailAddress;
    (async () => {
      try {
        const res = await fetch("/api/admin/config");
        if (!cancelled) setIsAdminUser(res.ok || isAdminEmail(email));
      } catch {
        if (!cancelled) setIsAdminUser(isAdminEmail(email));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, user]);

  if (!isLoaded || isAdminUser === null) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-zinc-400" size={32} />
      </div>
    );
  }

  if (!isAdminUser) {
    return (
      <div className="text-center py-20">
        <Shield size={48} className="mx-auto text-zinc-300 mb-4" />
        <p className="text-zinc-500">You do not have admin access.</p>
        <Link
          href="/dashboard"
          className="mt-4 inline-flex items-center gap-2 text-sm text-blue-600 hover:underline"
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
