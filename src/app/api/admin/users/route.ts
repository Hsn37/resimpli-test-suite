import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { isAdmin } from "@/lib/admin";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const clerk = await clerkClient();
    const user = await clerk.users.getUser(userId);
    const email = user.emailAddresses[0]?.emailAddress;
    if (!isAdmin(email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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
