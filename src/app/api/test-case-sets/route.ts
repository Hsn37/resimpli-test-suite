import { NextResponse } from "next/server";
import { createTestCaseSet, listTestCaseSets } from "@/lib/db";
import type { TestCase } from "@/lib/testCase";

export async function GET() {
  try {
    const sets = await listTestCaseSets();
    return NextResponse.json(sets);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to list test case sets";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, cases } = body as { name?: string; cases?: Omit<TestCase, "id">[] };

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const id = await createTestCaseSet(name, cases ?? []);
    return NextResponse.json({ id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create test case set";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
