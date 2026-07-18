const RETELL_BASE_URL = "https://api.retellai.com";

// Every request requires an explicit key. Resolve it per workspace via
// retellKeyForWorkspace (RETELL_DEV_KEY / RETELL_PROD_KEY) — there is no shared
// RETELL_API_KEY fallback, so a workspace can never silently borrow another
// workspace's account (e.g. prod falling back to the dev key).
function headers(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

export async function listAgents(apiKey: string) {
  // is_latest=true returns one entry per agent (its latest version). Without
  // it, /list-agents returns every version, so name lookups can resolve to a
  // stale pre-rename name depending on which version is read last.
  const res = await fetch(`${RETELL_BASE_URL}/list-agents?is_latest=true`, {
    method: "GET",
    headers: headers(apiKey),
  });
  if (!res.ok) throw new Error(`Retell API error: ${res.status}`);
  return res.json();
}

export async function getAgent(agentId: string, apiKey: string) {
  const res = await fetch(`${RETELL_BASE_URL}/get-agent/${agentId}`, {
    method: "GET",
    headers: headers(apiKey),
  });
  if (!res.ok) throw new Error(`Retell API error: ${res.status}`);
  return res.json();
}

export async function getAgentVersions(agentId: string, apiKey: string) {
  const res = await fetch(
    `${RETELL_BASE_URL}/get-agent-versions/${agentId}`,
    { method: "GET", headers: headers(apiKey) }
  );
  if (!res.ok) throw new Error(`Retell API error: ${res.status}`);
  return res.json();
}

export async function createWebCall(
  body: {
    agent_id: string;
    retell_llm_dynamic_variables?: Record<string, string>;
    metadata?: Record<string, string>;
    agent_override?: {
      conversation_flow?: { start_speaker?: "agent" | "user" };
    };
  },
  apiKey: string
) {
  const res = await fetch(`${RETELL_BASE_URL}/v2/create-web-call`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Retell create-web-call error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function listCalls(
  body: {
    limit?: number;
    pagination_key?: string;
    filter_criteria?: Record<string, unknown>;
    sort_order?: "ascending" | "descending";
  } = {},
  apiKey: string
) {
  const res = await fetch(`${RETELL_BASE_URL}/v2/list-calls`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      sort_order: body.sort_order ?? "descending",
      limit: body.limit ?? 50,
      ...(body.filter_criteria ? { filter_criteria: body.filter_criteria } : {}),
      ...(body.pagination_key ? { pagination_key: body.pagination_key } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Retell API error: ${res.status}`);
  return res.json();
}

export async function getCall(callId: string, apiKey: string) {
  const res = await fetch(`${RETELL_BASE_URL}/v2/get-call/${callId}`, {
    method: "GET",
    headers: headers(apiKey),
  });
  if (!res.ok) throw new Error(`Retell API error: ${res.status}`);
  return res.json();
}

export async function listRetellLlms(apiKey: string) {
  const res = await fetch(`${RETELL_BASE_URL}/list-retell-llms`, {
    method: "GET",
    headers: headers(apiKey),
  });
  if (!res.ok) throw new Error(`Retell API error: ${res.status}`);
  return res.json();
}

export interface ResponseEngine {
  type: "retell-llm" | "conversation-flow";
  llm_id?: string;
  conversation_flow_id?: string;
  version?: number;
}

export interface TestCaseDefinitionInput {
  response_engine: ResponseEngine;
  name: string;
  user_prompt: string;
  metrics: string[];
  dynamic_variables?: Record<string, string>;
  tool_mocks?: unknown[];
  llm_model: string;
}

export async function createTestCaseDefinition(
  body: TestCaseDefinitionInput,
  apiKey: string
) {
  const res = await fetch(`${RETELL_BASE_URL}/create-test-case-definition`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Retell create-test-case-definition error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function createBatchTest(
  body: {
    response_engine: ResponseEngine;
    test_case_definition_ids: string[];
  },
  apiKey: string
) {
  const res = await fetch(`${RETELL_BASE_URL}/create-batch-test`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Retell create-batch-test error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function getBatchTest(batchId: string, apiKey: string) {
  const res = await fetch(`${RETELL_BASE_URL}/get-batch-test/${batchId}`, {
    method: "GET",
    headers: headers(apiKey),
  });
  if (!res.ok) throw new Error(`Retell API error: ${res.status}`);
  return res.json();
}

export async function listTestRuns(
  batchId: string,
  apiKey: string,
  opts: { limit?: number; paginationKey?: string } = {}
) {
  const params = new URLSearchParams();
  params.set("limit", String(opts.limit ?? 1000));
  if (opts.paginationKey) params.set("pagination_key", opts.paginationKey);

  const res = await fetch(
    `${RETELL_BASE_URL}/v2/list-test-runs/${batchId}?${params.toString()}`,
    { method: "GET", headers: headers(apiKey) }
  );
  if (!res.ok) throw new Error(`Retell API error: ${res.status}`);
  return res.json();
}

/** Fetch every page of test runs for a batch, following pagination_key until has_more is false. */
export async function listAllTestRuns(batchId: string, apiKey: string) {
  const items: Record<string, unknown>[] = [];
  let paginationKey: string | undefined;
  for (;;) {
    const page = await listTestRuns(batchId, apiKey, { paginationKey });
    items.push(...(page.items ?? []));
    if (!page.has_more || !page.pagination_key) break;
    paginationKey = page.pagination_key;
  }
  return items;
}

// ---------------------------------------------------------------------------
// Chat API (used by the LEGACY Retell call grader — superseded by the OpenAI
// grader, kept for reference; see src/lib/grader.ts).
// ---------------------------------------------------------------------------

export async function createRetellLlm(body: { general_prompt: string }, apiKey: string) {
  const res = await fetch(`${RETELL_BASE_URL}/create-retell-llm`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Retell create-retell-llm error ${res.status}: ${text}`);
  }
  return res.json();
}

export type PostChatAnalysisField =
  | { type: "number"; name: string; description: string; required?: boolean }
  | { type: "string"; name: string; description: string; required?: boolean }
  | { type: "boolean"; name: string; description: string; required?: boolean }
  | {
      type: "enum";
      name: string;
      description: string;
      choices: string[];
      required?: boolean;
    };

export async function createChatAgent(
  body: {
    response_engine: ResponseEngine;
    post_chat_analysis_data: PostChatAnalysisField[];
  },
  apiKey: string
) {
  const res = await fetch(`${RETELL_BASE_URL}/create-chat-agent`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Retell create-chat-agent error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function createChat(body: { agent_id: string }, apiKey: string) {
  const res = await fetch(`${RETELL_BASE_URL}/create-chat`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Retell create-chat error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function createChatCompletion(
  body: { chat_id: string; content: string },
  apiKey: string
) {
  const res = await fetch(`${RETELL_BASE_URL}/create-chat-completion`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Retell create-chat-completion error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function endChat(chatId: string, apiKey: string): Promise<void> {
  const res = await fetch(`${RETELL_BASE_URL}/end-chat/${chatId}`, {
    method: "PATCH",
    headers: headers(apiKey),
  });
  if (!res.ok) throw new Error(`Retell API error: ${res.status}`);
}

export interface ChatAnalysis {
  chat_summary?: string;
  user_sentiment?: string;
  chat_successful?: boolean;
  custom_analysis_data?: Record<string, unknown>;
}

export interface ChatResponse {
  chat_id: string;
  agent_id: string;
  chat_status: "ongoing" | "ended" | "error";
  chat_analysis?: ChatAnalysis;
}

export async function getChat(chatId: string, apiKey: string): Promise<ChatResponse> {
  const res = await fetch(`${RETELL_BASE_URL}/get-chat/${chatId}`, {
    method: "GET",
    headers: headers(apiKey),
  });
  if (!res.ok) throw new Error(`Retell API error: ${res.status}`);
  return res.json();
}
