import { defineConfig } from "drizzle-kit";

// Used only to generate SQL migrations from the schema (`npm run db:generate`).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/infrastructure/db/schema.ts",
  out: "./drizzle",
});
