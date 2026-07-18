import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getServerWorkspace } from "@/lib/workspaceServer";
import { APP_CONFIG_KEYS } from "@/lib/graderRubric";
import {
  listFailureClasses,
  listRepDimensions,
  upsertFailureClass,
  upsertRepDimension,
  failureClassKeyExists,
  repDimensionKeyExists,
  getAppConfig,
  setAppConfig,
  type RubricUpsert,
} from "@/lib/db";
import {
  RUBRIC_KINDS,
  type RubricKind,
  isRubricKind,
} from "@/lib/rubricKinds";
import type { Workspace } from "@/lib/workspace";

// Immutable keys must match the grader contract: lowercase snake_case only.
const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

// Per-kind write helpers, so the route stays DRY across failure classes + rep
// dimensions (identical shape, different table).
const RUBRIC_WRITERS: Record<
  RubricKind,
  {
    keyExists: (w: Workspace, key: string) => Promise<boolean>;
    upsert: (w: Workspace, row: RubricUpsert) => Promise<void>;
  }
> = {
  failure_class: { keyExists: failureClassKeyExists, upsert: upsertFailureClass },
  rep_dimension: { keyExists: repDimensionKeyExists, upsert: upsertRepDimension },
};

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  try {
    const workspace = await getServerWorkspace();
    const [failureClasses, repDimensions, systemPrompt] = await Promise.all([
      listFailureClasses(workspace),
      listRepDimensions(workspace),
      getAppConfig<string>(workspace, APP_CONFIG_KEYS.graderSystemPrompt),
    ]);
    return NextResponse.json({
      workspace,
      failureClasses,
      repDimensions,
      systemPrompt: systemPrompt ?? "",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load rubric";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface RubricPatchBody {
  kind?: string;
  row?: {
    key?: unknown;
    name?: unknown;
    definition?: unknown;
    sort_order?: unknown;
    active?: unknown;
  };
  isNew?: boolean;
  systemPrompt?: unknown;
}

export async function PATCH(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  try {
    const workspace = await getServerWorkspace();
    const body = (await request.json()) as RubricPatchBody;

    // Grader system prompt update (app_config) — mutually exclusive with a row.
    if (typeof body.systemPrompt === "string") {
      await setAppConfig(workspace, APP_CONFIG_KEYS.graderSystemPrompt, body.systemPrompt);
      return NextResponse.json({ ok: true });
    }

    const { kind, row, isNew } = body;
    if (!isRubricKind(kind)) {
      return NextResponse.json(
        { error: `kind must be one of ${RUBRIC_KINDS.join(", ")}` },
        { status: 400 }
      );
    }
    if (!row || typeof row !== "object") {
      return NextResponse.json({ error: "row is required" }, { status: 400 });
    }

    const key = typeof row.key === "string" ? row.key.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const definition = typeof row.definition === "string" ? row.definition.trim() : "";
    const sortOrder = Number(row.sort_order);
    const active = row.active !== false; // default true

    if (!key || !KEY_PATTERN.test(key)) {
      return NextResponse.json(
        { error: "key must be lowercase snake_case (e.g. re_asked_known_data)" },
        { status: 400 }
      );
    }
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (!definition) {
      return NextResponse.json({ error: "definition is required" }, { status: 400 });
    }
    if (!Number.isFinite(sortOrder)) {
      return NextResponse.json({ error: "sort_order must be a number" }, { status: 400 });
    }

    const writer = RUBRIC_WRITERS[kind];

    // On create, the key is immutable and must be unique per workspace.
    if (isNew && (await writer.keyExists(workspace, key))) {
      return NextResponse.json(
        { error: `key "${key}" already exists in this workspace` },
        { status: 409 }
      );
    }

    await writer.upsert(workspace, {
      key,
      name,
      definition,
      sort_order: sortOrder,
      active,
    });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to save rubric";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
