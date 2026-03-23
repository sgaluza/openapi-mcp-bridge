import type { Command } from "commander";
import chalk from "chalk";

const collect = (val: string, acc: string[]) => [...acc, val];

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
    .option("--bind <binding>", "Pre-bind a parameter to a fixed value: key=value (repeatable)", collect, [])
    .addHelpText("after", `
GraphQL support is in development. Track progress at:
https://github.com/sgaluza/api-to-mcp/issues/1`)
    .action((_endpoint: string, opts: { readonly?: boolean; only?: string; exclude?: string; bind: string[] }) => {
      process.stderr.write(
        chalk.yellow("⚠ GraphQL support is coming soon.\n") +
        (opts.only || opts.exclude || opts.readonly || opts.bind
          ? chalk.yellow("  Note: --only, --exclude, --readonly, and --bind will be available after implementation.\n")
          : "") +
        `  Track progress: ${chalk.dim("https://github.com/sgaluza/api-to-mcp/issues/1")}\n`
      );
      process.exit(1);
    });
}
