// Client-side admin check (mirrors the server-side isAdmin in admin.ts, but
// reads the public env var so it can run in the browser). This is a UX gate
// only — every admin-only API route still enforces via requireAdmin() on the
// server, which is the real security boundary.

export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase());
  return adminEmails.includes(email.toLowerCase());
}
