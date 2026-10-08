// Run the backend AI-usage sync now (ignores the 30-min throttle) and keep
// going until history is loaded — the first load, or after pointing
// AI_AUDIT_MONGO_URL at a different database.
//
//   npx tsx --conditions=react-server scripts/sync-ai-usage.ts
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { runAiUsageSync } from "../src/lib/aiUsageSync";

async function main() {
  for (;;) {
    const r = await runAiUsageSync({ deadline: Date.now() + 120_000, force: true });
    console.log(JSON.stringify(r));
    if (r.skipped === "no_url") throw new Error("AI_AUDIT_MONGO_URL is not set");
    if (!r.error) break;
    if (!r.error.startsWith("out of time")) throw new Error(r.error);
  }
  process.exit(0); // the Mongo client keeps the event loop alive
}

main().catch((err) => {
  console.error("AI usage sync failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
