import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DbClient } from "./dbClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(): Promise<void> {
  const schemaPath = path.resolve(__dirname, "../../database/schema.sql");
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema file not found at: ${schemaPath}`);
  }

  const ddl = fs.readFileSync(schemaPath, "utf-8");
  console.log(`[Database Migration] Running schema DDL from: ${schemaPath}`);

  await DbClient.query(ddl);
  console.log("[Database Migration] Schema applied successfully. Core tables verified.");
}

if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
  runMigrations()
    .then(async () => {
      console.log("[Database Migration] Complete.");
      await DbClient.closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("[Database Migration] Error applying migrations:", err);
      await DbClient.closePool();
      process.exit(1);
    });
}
