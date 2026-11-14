import tseslint from "typescript-eslint";

const restrict = (regex, message) => ["error", { patterns: [{ regex, message }] }];

export default tseslint.config(
  { ignores: ["**/node_modules/**", "prototype/**", "apps/server/drizzle/**", "data/**", "content/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    files: ["**/test/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off", "@typescript-eslint/no-non-null-assertion": "off" },
  },

  // --- Dependency direction ---------------------------------------------------------------------
  {
    // Contracts are consumed by the future mobile client: only zod and their own files.
    files: ["packages/contracts/src/**"],
    rules: {
      "no-restricted-imports": restrict(
        "^(?!zod$|\\./)",
        "Contracts must stay runtime-neutral: import only zod and local files.",
      ),
      "no-restricted-globals": ["error", "process", "Buffer", "window", "document", "require", "__dirname"],
    },
  },
  {
    // Private content tooling must not depend on the server or on HTTP/database layers.
    files: ["packages/content-tools/src/**"],
    rules: {
      "no-restricted-imports": restrict(
        "^(@signal-hunt/server|fastify|@fastify/|drizzle-orm|better-sqlite3)",
        "content-tools depends only on contracts, zod and Node built-ins.",
      ),
    },
  },
  {
    // Application and domain code never see Fastify; only app.ts and infrastructure/http adapt HTTP.
    files: ["apps/server/src/modules/**"],
    rules: {
      "no-restricted-imports": restrict(
        "^(fastify|@fastify/)|/infrastructure/http/|/test/",
        "Modules must not depend on HTTP adapters.",
      ),
    },
  },
  {
    // Domain rules are pure: no Fastify, Drizzle, SQLite, Node built-ins, infrastructure or repositories.
    files: ["apps/server/src/modules/**/domain.ts"],
    rules: {
      "no-restricted-imports": restrict(
        "^(?!@signal-hunt/contracts$)",
        "Domain rules may import only @signal-hunt/contracts.",
      ),
    },
  },
  {
    // Production code never imports test doubles.
    files: ["apps/server/src/**"],
    ignores: ["apps/server/src/modules/**"],
    rules: {
      "no-restricted-imports": restrict(
        "/test/|\\.test$|harness",
        "Test adapters are excluded from runtime composition.",
      ),
    },
  },
);
