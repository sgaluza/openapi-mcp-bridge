import { Command } from "commander";
import chalk from "chalk";
import { registerRestCommand } from "./commands/rest.js";
import { registerGraphqlCommand } from "./commands/graphql.js";

const program = new Command();

program
  .name("api-to-mcp")
  .description("Turn any API (OpenAPI, GraphQL coming soon) into an MCP server via stdio bridge.")
  .addHelpText("after", `
Subcommands:
  rest      Start MCP server from an OpenAPI spec
  graphql   Start MCP server from a GraphQL schema (coming soon)

Examples:
  $ api-to-mcp rest https://api.example.com/openapi.yaml
  $ api-to-mcp rest ./openapi.yaml --readonly
  $ api-to-mcp graphql https://api.example.com/graphql`);

registerRestCommand(program);
registerGraphqlCommand(program);

// Friendly error when no subcommand provided
program.action(() => {
  process.stderr.write(
    chalk.red("Error: subcommand required.\n\n") +
    `  Use ${chalk.bold("api-to-mcp rest <spec>")} for OpenAPI\n` +
    `  Use ${chalk.bold("api-to-mcp graphql <endpoint>")} for GraphQL\n\n` +
    `Run ${chalk.dim("api-to-mcp --help")} for more information.\n`
  );
  process.exit(1);
});

program.parseAsync(process.argv).catch((error) => {
  process.stderr.write(chalk.red("✗ Fatal error: ") + (error.message || error) + "\n");
  process.exit(1);
});
