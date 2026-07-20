// Deploy-time database migration. Applies the idempotent CREATE TABLE/INDEX +
// seed DDL once, so the app's request path never pays for it on a cold start.
// Wired into the build step (package.json "build" runs `npm run migrate`).
//
// db.ts is `server-only`; run under the react-server condition so Next's
// `server-only` resolves to a no-op (same as the other CLI scripts). Manual run:
//   npx tsx --conditions=react-server scripts/migrate.ts
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { migrateSchema } from "../src/lib/db";

async function main() {
  console.log("Applying database schema…");
  await migrateSchema();
  console.log("Schema up to date.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
