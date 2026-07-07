import { NextResponse } from "next/server";
import {
  deleteTestCaseSet,
  getTestCaseSet,
  renameTestCaseSet,
  replaceTestCases,
} from "@/lib/db";
import type { TestCase } from "@/lib/testCase";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const set = await getTestCaseSet(id);
    if (!set) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(set);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to get test case set";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, cases } = body as { name?: string; cases?: Omit<TestCase, "id">[] };

    if (name !== undefined) {
      await renameTestCaseSet(id, name);
    }
    if (cases !== undefined) {
      await replaceTestCases(id, cases);
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update test case set";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deleteTestCaseSet(id);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete test case set";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
