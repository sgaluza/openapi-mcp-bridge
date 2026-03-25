import type { Command } from "commander";
import chalk from "chalk";
import { loadGraphQLSchema } from "../graphql-loader.js";
import { buildGraphQLTools } from "../graphql-tool-builder.js";
import type { GraphQLToolDefinition } from "../graphql-tool-builder.js";
import { executeGraphQLCall } from "../graphql-executor.js";
import { filterTools, applyBindings } from "../tool-builder.js";
import { parseHeaderFlags, resolveAuthHeaders } from "../auth.js";
import { startMcpServer } from "../mcp-server.js";
import { resolveFilterOptions } from "./filter-options.js";
import { parseBindings } from "./bind-options.js";
import { loadConfigFile, mergeEnvWithConfig } from "../config-file.js";
import { SPEC_OPTION, resolveOption, registerOptions, findSharedOption } from "../options-schema.js";

const collect = (val: string, acc: string[]) => [...acc, val];

/** Register the `graphql` subcommand onto the given commander program. */
export function registerGraphqlCommand(program: Command): void {
  const cmd = program
    .command("graphql")
    .description("Start an MCP server from a GraphQL schema")
    .argument("[endpoint]", "GraphQL endpoint URL or SDL file path")
    .option("-H, --header <header>", "Add a request header (repeatable)", collect, [])
    .option("--bind <binding>", "Pre-bind a parameter to a fixed value: key=value (repeatable)", collect, [])
    .addHelpText("after", `
Environment variables:
  API2MCP_SPEC_URL      GraphQL endpoint URL (alternative to positional arg)
  API2MCP_READONLY      Expose only read operations (same as --readonly)
  API2MCP_ONLY          Whitelist operations, comma-separated (same as --only)
  API2MCP_EXCLUDE       Blacklist operations, comma-separated (same as --exclude)
  API2MCP_BEARER_TOKEN  Bearer token (adds Authorization: Bearer header)
  API2MCP_API_KEY       API key (adds X-API-Key header)

Examples:
  $ api-to-mcp graphql https://api.github.com/graphql -H "Authorization: Bearer ghp_xxx"
  $ api-to-mcp graphql ./schema.graphql
  $ api-to-mcp graphql https://api.linear.app/graphql --readonly
  $ api-to-mcp graphql https://api.example.com/graphql --only "query_issues,query_viewer"
  $ api-to-mcp graphql https://api.example.com/graphql --bind "teamId=TEAM_ABC"`);

  registerOptions(cmd, SHARED_OPTIONS);

  cmd.action(async (endpointArg: string, opts: {
    header: string[];
    readonly?: boolean;
    only?: string;
    exclude?: string;
    bind: string[];
    config?: string;
  }) => {
      const configFile = loadConfigFile(opts.config);
      const endpoint = resolveOption(SPEC_OPTION, endpointArg, process.env, configFile);

      if (!endpoint) {
        process.stderr.write(
          chalk.red(
            "Error: no endpoint provided. Pass as argument or set API2MCP_SPEC_URL.\n"
          )
        );
        process.exit(1);
      }

      const readonly = resolveOption(findSharedOption("readonly"), opts.readonly, process.env, configFile) ?? false;
      const bindings = { ...(configFile?.options?.bind ?? {}), ...parseBindings(opts.bind) };

      // Build auth headers: config.auth.headers (lowest) < env vars < CLI flags (highest)
      const mergedEnv = mergeEnvWithConfig(process.env, configFile?.auth);
      const authHeaders = {
        ...(configFile?.auth?.headers ?? {}),
        ...resolveAuthHeaders(null, {
          cliHeaders: parseHeaderFlags(opts.header),
          env: mergedEnv,
        }),
      };

      const schema = await loadGraphQLSchema(endpoint, authHeaders);
      const allTools = buildGraphQLTools(schema, { readonly });

      // Warn if any binding key is not found in any tool
      const allParamNames = new Set(
        allTools.flatMap((t) => Object.keys(t.inputSchema.properties))
      );
      for (const key of Object.keys(bindings)) {
        if (!allParamNames.has(key)) {
          process.stderr.write(
            chalk.yellow(
              `Warning: --bind key '${key}' not found in any tool. Check for typos.\n`
            )
          );
        }
      }

      const bound = applyBindings(allTools, bindings);
      const mergedOpts = {
        only: resolveOption(findSharedOption("only"), opts.only, process.env, configFile),
        exclude: resolveOption(findSharedOption("exclude"), opts.exclude, process.env, configFile),
      };
      const { only, exclude } = resolveFilterOptions(mergedOpts, bound);
      // readonly is already applied in buildGraphQLTools - pass false here
      const tools = filterTools(bound, { only, exclude });

      if (tools.length === 0) {
        const applied = [
          readonly && "readonly",
          mergedOpts.only && `only=${mergedOpts.only}`,
          mergedOpts.exclude && `exclude=${mergedOpts.exclude}`,
          Object.keys(bindings).length > 0 &&
            `bind=[${Object.keys(bindings).join(", ")}]`,
        ]
          .filter(Boolean)
          .join(", ");
        process.stderr.write(
          chalk.red(
            `Error: no tools remaining after filtering` +
              ` (had ${allTools.length} tools before filters).\n` +
              `Applied filters: ${applied}\n`
          )
        );
        process.exit(1);
      }

      await startMcpServer({
        serverName: "graphql-api",
        serverVersion: "0.1.0",
        tools,
        specSource: endpoint,
        baseUrl: endpoint,
        readonly,
        executeCall: (tool, args) =>
          executeGraphQLCall(
            tool as GraphQLToolDefinition,
            { ...args, ...bindings },
            endpoint,
            authHeaders
          ),
      });
    });
}
