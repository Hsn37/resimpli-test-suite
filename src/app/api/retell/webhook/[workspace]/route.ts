import { NextRequest, NextResponse, after } from "next/server";
import { isWorkspace } from "@/lib/workspace";
import { retellKeyForWorkspace } from "@/lib/workspaceServer";
import {
  getAgentAllowlist,
  getTrackingStartDate,
  ingestCall,
  type RetellCallPayload,
} from "@/lib/ingestion";
import { gradeAndStoreCall } from "@/lib/grading";
import { verifyRetellWebhook, RETELL_SIGNATURE_HEADER } from "@/lib/retellWebhook";

// Retell webhook receiver, workspace-scoped by path. Verifies the signature
// against Retell's scheme (HMAC-SHA256 of rawBody+timestamp, keyed by the
// workspace's Retell API key — see retellWebhook.ts; degrades to verified=false
// only when no key is available), applies the same ingestion filters as
// backfill, upserts the call, and fires gradeAndStoreCall in the background via
// after() so the webhook returns fast.
//
// NOT admin-gated (Retell calls it machine-to-machine) but signature-guarded above.

// Only these terminal/analyzed events are ingested.
const INGESTED_EVENTS = ["call_ended", "call_analyzed"];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspace: string }> }
) {
  const { workspace } = await params;
  if (!isWorkspace(workspace)) {
    return NextResponse.json({ error: "Unknown workspace" }, { status: 404 });
  }

  // Resolve the workspace's Retell key up front — it doubles as the webhook
  // signing key (Retell signs with the API key). Missing key is tolerated:
  // verification degrades to verified=false and enrichment is skipped below.
  let apiKey: string;
  try {
    apiKey = retellKeyForWorkspace(workspace);
  } catch {
    apiKey = "";
  }

  const rawBody = await request.text();
  const verification = verifyRetellWebhook(
    rawBody,
    request.headers.get(RETELL_SIGNATURE_HEADER),
    apiKey || undefined
  );
  if (!verification.ok) {
    return NextResponse.json(
      { error: "Invalid signature", reason: verification.reason },
      { status: 401 }
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = typeof payload.event === "string" ? payload.event : "";
  const call = (payload.call ?? payload.data ?? payload) as RetellCallPayload;
  if (!call || typeof call !== "object") {
    return NextResponse.json({ error: "No call payload" }, { status: 400 });
  }

  // Only terminal / analyzed events are ingested; ack everything else.
  if (event && !INGESTED_EVENTS.includes(event)) {
    return NextResponse.json({ ok: true, skipped: "event", event });
  }

  const [allowlist, trackingStart] = await Promise.all([
    getAgentAllowlist(workspace),
    getTrackingStartDate(workspace),
  ]);

  const result = await ingestCall({
    workspace,
    call,
    allowlist,
    trackingStart,
    apiKey: apiKey || undefined,
    enrich: true,
    rawPayload: payload,
  });

  if (result.skip) {
    return NextResponse.json({ ok: true, skipped: result.skip });
  }

  // Grade in the background so the webhook returns immediately. Graceful with an
  // empty OPENAI_API_KEY — gradeAndStoreCall stores an error row, never throws.
  const callRowId = result.callRowId;
  if (callRowId) {
    after(async () => {
      try {
        await gradeAndStoreCall(workspace, callRowId);
      } catch (e) {
        console.error("[webhook] grade failed", callRowId, e);
      }
    });
  }

  return NextResponse.json({ ok: true, call_id: callRowId, verified: verification.verified });
}
