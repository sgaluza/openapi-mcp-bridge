import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        // Entry point — runs parseAsync at module level, cannot be imported in unit tests
        "src/index.ts",
        // CLI action handlers — covered by branch but not statement (require stdio MCP process)
        "src/commands/rest.ts",
        "src/commands/graphql.ts",
      ],
    },
  },
});
