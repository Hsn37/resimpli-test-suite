import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getOpenAiCostReport } from "@/lib/openaiCostReport";
import { daysBetween, isDay } from "@/lib/costs";

// OpenAI spend for the Costs Dashboard. Prefers synced organization billing;
// without an Admin key, falls back to PromptLayer's observed stage analytics
// plus tokenizer-derived template floors. Same audience as /api/costs: every
// signed-in user (aggregate spend/tokens only — never prompt or output text).
//
// Query: from, to (YYYY-MM-DD, inclusive). OpenAI's days are UTC.

const MAX_SPAN_DAYS = 800;

// A cold PromptLayer fallback fetches analytics and the stage template
// inventory. Subsequent requests use the shared database cache.
export const maxDuration = 60;

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  if (!isDay(from) || !isDay(to) || to < from) {
    return NextResponse.json({ error: "from/to must be YYYY-MM-DD days with to >= from" }, { status: 400 });
  }
  if (daysBetween(from, to) > MAX_SPAN_DAYS) {
    return NextResponse.json({ error: "Range too large (max ~2 years)" }, { status: 400 });
  }

  try {
    return NextResponse.json(await getOpenAiCostReport({ from, to }));
  } catch (err) {
    console.error("[api/costs/openai] report failed", err);
    return NextResponse.json({ error: "Failed to load OpenAI costs" }, { status: 500 });
  }
}
