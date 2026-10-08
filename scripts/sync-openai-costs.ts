// Run the OpenAI spend sync now, ignoring the hourly throttle (first load, or
// after rotating OPENAI_API_ADMIN_KEY). Loops until history is fully loaded.
//
//   npx tsx --conditions=react-server scripts/sync-openai-costs.ts
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { runOpenAiCostSync } from "../src/lib/openaiCosts";

async function main() {
  for (;;) {
    const r = await runOpenAiCostSync({ deadline: Date.now() + 120_000, force: true });
    console.log(JSON.stringify(r));
    if (r.skipped === "no_key") throw new Error("OPENAI_API_ADMIN_KEY is not set");
    if (!r.error) break;
    if (!r.error.startsWith("out of time")) throw new Error(r.error);
  }
}

main().catch((err) => {
  console.error("OpenAI cost sync failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
