import "server-only";
import { auth, clerkClient } from "@clerk/nextjs/server";

export function isAdmin(email: string | undefined | null): boolean {
  if (!email) return false;
  const adminEmails = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase());
  return adminEmails.includes(email.toLowerCase());
}

export type AdminGuardResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; error: "Unauthorized" | "Forbidden"; status: 401 | 403 };

/** Verifies the current Clerk session belongs to an admin. Use at the top of every admin-only API route. */
export async function requireAdmin(): Promise<AdminGuardResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Unauthorized", status: 401 };

  const clerk = await clerkClient();
  const user = await clerk.users.getUser(userId);
  const email = user.emailAddresses[0]?.emailAddress;
  if (!isAdmin(email)) return { ok: false, error: "Forbidden", status: 403 };

  return { ok: true, userId, email };
}
