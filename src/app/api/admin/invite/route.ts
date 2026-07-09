import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { requireAdmin } from "@/lib/admin";

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  try {
    const clerk = await clerkClient();
    const body = await request.json();
    const { emailAddress } = body;
    if (!emailAddress) {
      return NextResponse.json(
        { error: "emailAddress is required" },
        { status: 400 }
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.headers.get("origin") || "";
    const invitation = await clerk.invitations.createInvitation({
      emailAddress,
      redirectUrl: `${appUrl}/sign-up`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    return NextResponse.json({ id: invitation.id, emailAddress });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to send invite";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
