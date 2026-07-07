// Shared, client-safe types for batch test cases. Kept separate from db.ts
// (which is "server-only") so client components can import the shape.

export interface TestCase {
  id: string;
  name: string;
  user_prompt: string;
  metrics: string[];
  dynamic_variables: Record<string, string>;
  tool_mocks: unknown[];
  llm_model: string;
}

export const LLM_MODEL_OPTIONS = [
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-5.1",
  "gpt-5.2",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.5",
  "claude-4.5-sonnet",
  "claude-4.6-sonnet",
  "claude-5-sonnet",
  "claude-4.5-haiku",
  "gemini-3.0-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
] as const;

export function emptyTestCase(): Omit<TestCase, "id"> {
  return {
    name: "New test case",
    user_prompt: "",
    metrics: [],
    dynamic_variables: {},
    tool_mocks: [],
    llm_model: "gpt-5.4",
  };
}
