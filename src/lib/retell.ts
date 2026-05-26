const RETELL_BASE_URL = "https://api.retellai.com";

function getApiKey(): string {
  const key = process.env.RETELL_API_KEY;
  if (!key) throw new Error("RETELL_API_KEY is not set");
  return key;
}

function headers(): HeadersInit {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    "Content-Type": "application/json",
  };
}

export async function listAgents() {
  const res = await fetch(`${RETELL_BASE_URL}/list-agents`, {
    method: "GET",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Retell API error: ${res.status}`);
  return res.json();
}

export async function getAgent(agentId: string) {
  const res = await fetch(`${RETELL_BASE_URL}/get-agent/${agentId}`, {
    method: "GET",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Retell API error: ${res.status}`);
  return res.json();
}

export async function getAgentVersions(agentId: string) {
  const res = await fetch(
    `${RETELL_BASE_URL}/get-agent-versions/${agentId}`,
    { method: "GET", headers: headers() }
  );
  if (!res.ok) throw new Error(`Retell API error: ${res.status}`);
  return res.json();
}

export async function createWebCall(body: {
  agent_id: string;
  retell_llm_dynamic_variables?: Record<string, string>;
  metadata?: Record<string, string>;
  agent_override?: {
    conversation_flow?: { start_speaker?: "agent" | "user" };
  };
}) {
  const res = await fetch(`${RETELL_BASE_URL}/v2/create-web-call`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Retell create-web-call error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function getCall(callId: string) {
  const res = await fetch(`${RETELL_BASE_URL}/v2/get-call/${callId}`, {
    method: "GET",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Retell API error: ${res.status}`);
  return res.json();
}
