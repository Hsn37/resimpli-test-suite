// LEGACY: Retell grader — superseded by src/lib/openaiGrader.ts. Kept for
// reference, intentionally unwired. The grader is now OpenAI-based and needs no
// Retell chat agent. Do not re-wire without a decision.
//
// One-time setup: creates the retell-llm + chat agent that acts as the AI
// call grader, configured with post_chat_analysis_data so we get back a
// structured {grade, note} after each graded chat.
//
// Run: npx tsx scripts/setup-grader-agent.ts
// Then put the printed agent_id in .env as RETELL_GRADER_AGENT_ID.

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { createChatAgent, createRetellLlm } from "../src/lib/retell";
import { GRADER_SYSTEM_PROMPT } from "../src/lib/graderPrompt";

async function main() {
  // The grader agent is a dev-workspace artifact; use the dev Retell key
  // explicitly (there is no shared RETELL_API_KEY fallback anymore).
  const RETELL_KEY = process.env.RETELL_DEV_KEY;
  if (!RETELL_KEY) throw new Error("RETELL_DEV_KEY is not set");

  console.log("Creating grader retell-llm...");
  const llm = await createRetellLlm({ general_prompt: GRADER_SYSTEM_PROMPT }, RETELL_KEY);
  const llmId = llm.llm_id;
  console.log(`  llm_id: ${llmId}`);

  console.log("Creating grader chat agent...");
  const agent = await createChatAgent(
    {
      response_engine: { type: "retell-llm", llm_id: llmId },
      post_chat_analysis_data: [
      {
        type: "number",
        name: "grade",
        description: "Overall conversational-quality score from 1 to 5.",
        required: true,
      },
      {
        type: "string",
        name: "note",
        description:
          "One short sentence explaining the score, naming the 1-2 most relevant heuristics.",
        required: true,
      },
      ],
    },
    RETELL_KEY
  );

  console.log("\nDone. Add this to .env:");
  console.log(`RETELL_GRADER_AGENT_ID=${agent.agent_id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
