import type { Command } from "commander";
import chalk from "chalk";

/**
 * Register the `graphql` subcommand onto the given commander program.
 * Currently a stub — full implementation tracked in issue #1.
 */
export function registerGraphqlCommand(program: Command): void {
  program
    .command("graphql")
    .description("Start an MCP server from a GraphQL schema (coming soon)")
    .argument("<endpoint>", "GraphQL endpoint URL or SDL file path")
    .option("-H, --header <header>", "Add a request header (repeatable)")
    .option("--readonly", "Expose only Query operations (no Mutations)")
    .option("--only <operations>", "Whitelist operations by name, comma-separated")
    .option("--exclude <operations>", "Blacklist operations by name, comma-separated")
    .addHelpText("after", `
GraphQL support is in development. Track progress at:
https://github.com/sgaluza/api-to-mcp/issues/1`)
    .action((_endpoint: string, opts: { readonly?: boolean; only?: string; exclude?: string }) => {
      if (opts.only || opts.exclude) {
        process.stderr.write(chalk.yellow("Warning: --only and --exclude have no effect until GraphQL support is implemented.\n"));
      }
      process.stderr.write(
        chalk.yellow("⚠ GraphQL support is coming soon.\n") +
        `  Track progress: ${chalk.dim("https://github.com/sgaluza/api-to-mcp/issues/1")}\n`
      );
      process.exit(1);
    });
}
