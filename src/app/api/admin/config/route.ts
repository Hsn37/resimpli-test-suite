import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getServerWorkspace } from "@/lib/workspaceServer";
import { getAppConfigMap, setAppConfig } from "@/lib/db";
import {
  APP_CONFIG_KEYS,
  DEFAULT_GRADER_MODEL,
  DEFAULT_TRACKING_START_DATE,
} from "@/lib/graderRubric";
import type { Workspace } from "@/lib/workspace";

// Editable grading config keys exposed by this route (the rest of app_config —
// grader_system_prompt, backfill_complete — is owned elsewhere / read-only here).
const GRADING_KEYS = [
  APP_CONFIG_KEYS.graderModel,
  APP_CONFIG_KEYS.trackingStartDate,
  APP_CONFIG_KEYS.agentIdAllowlist,
  APP_CONFIG_KEYS.automationEnabled,
] as const;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  try {
    const workspace = await getServerWorkspace();
    const map = await getAppConfigMap(workspace);
    return NextResponse.json({
      workspace,
      config: {
        [APP_CONFIG_KEYS.graderModel]:
          (map[APP_CONFIG_KEYS.graderModel] as string) ?? DEFAULT_GRADER_MODEL,
        [APP_CONFIG_KEYS.trackingStartDate]:
          (map[APP_CONFIG_KEYS.trackingStartDate] as string) ?? DEFAULT_TRACKING_START_DATE,
        [APP_CONFIG_KEYS.agentIdAllowlist]: Array.isArray(map[APP_CONFIG_KEYS.agentIdAllowlist])
          ? (map[APP_CONFIG_KEYS.agentIdAllowlist] as string[])
          : [],
        [APP_CONFIG_KEYS.automationEnabled]: map[APP_CONFIG_KEYS.automationEnabled] !== false,
      },
      // Boolean only — the key itself is never sent to the client.
      openaiKeyPresent: Boolean(process.env.OPENAI_API_KEY),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load config";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface ConfigPatchBody {
  grader_model?: unknown;
  tracking_start_date?: unknown;
  agent_id_allowlist?: unknown;
  automation_enabled?: unknown;
}

/**
 * Validate one incoming config field. Returns the coerced value to persist, or
 * an error string. Keeps PATCH DRY across the four keys.
 */
function validateField(key: (typeof GRADING_KEYS)[number], value: unknown): { value: unknown } | { error: string } {
  switch (key) {
    case APP_CONFIG_KEYS.graderModel: {
      const model = typeof value === "string" ? value.trim() : "";
      if (!model) return { error: "grader_model must be a non-empty string" };
      return { value: model };
    }
    case APP_CONFIG_KEYS.trackingStartDate: {
      if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
        return { error: "tracking_start_date must be YYYY-MM-DD" };
      }
      return { value };
    }
    case APP_CONFIG_KEYS.agentIdAllowlist: {
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
        return { error: "agent_id_allowlist must be an array of strings" };
      }
      const cleaned = (value as string[]).map((v) => v.trim()).filter(Boolean);
      return { value: cleaned };
    }
    case APP_CONFIG_KEYS.automationEnabled: {
      if (typeof value !== "boolean") return { error: "automation_enabled must be a boolean" };
      return { value };
    }
  }
}

export async function PATCH(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  try {
    const workspace: Workspace = await getServerWorkspace();
    const body = (await request.json()) as ConfigPatchBody;

    // Collect only the keys present in the body; validate each before writing.
    const writes: { key: (typeof GRADING_KEYS)[number]; value: unknown }[] = [];
    for (const key of GRADING_KEYS) {
      if (!(key in body)) continue;
      const result = validateField(key, (body as Record<string, unknown>)[key]);
      if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      writes.push({ key, value: result.value });
    }

    if (writes.length === 0) {
      return NextResponse.json({ error: "No valid config fields provided" }, { status: 400 });
    }

    for (const w of writes) {
      await setAppConfig(workspace, w.key, w.value);
    }
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to save config";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
