import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { requireAdmin } from "@/lib/admin";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  try {
    const clerk = await clerkClient();
    const users = await clerk.users.getUserList({ limit: 100 });
    const invitations = await clerk.invitations.getInvitationList({ limit: 100 });

    const userList = users.data.map((u) => ({
      id: u.id,
      email: u.emailAddresses[0]?.emailAddress || "—",
      firstName: u.firstName,
      lastName: u.lastName,
      createdAt: u.createdAt,
      imageUrl: u.imageUrl,
    }));

    const pendingInvites = invitations.data
      .filter((i) => i.status === "pending")
      .map((i) => ({
        id: i.id,
        email: i.emailAddress,
        status: i.status,
        createdAt: i.createdAt,
      }));

    return NextResponse.json({ users: userList, pendingInvites });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to list users";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
