import type { Command } from "commander";
import chalk from "chalk";
import { loadSpec } from "../spec-loader.js";
import { buildTools, filterTools } from "../tool-builder.js";
import { executeToolCall, resolveBaseUrl } from "../executor.js";
import { resolveAuthHeaders, parseHeaderFlags } from "../auth.js";
import { startMcpServer } from "../mcp-server.js";

const collect = (val: string, acc: string[]) => [...acc, val];

/**
 * Register the `rest` subcommand onto the given commander program.
 */
export function registerRestCommand(program: Command): void {
  program
    .command("rest")
    .description("Start an MCP server from an OpenAPI spec")
    .argument("[spec]", "OpenAPI spec URL or file path")
    .option("-H, --header <header>", "Add a request header (repeatable)", collect, [])
    .option("--readonly", "Expose only read-only operations (GET/HEAD)")
    .addHelpText("after", `
Environment variables:
  API2MCP_SPEC_URL      OpenAPI spec URL or path (alternative to positional arg)
  API2MCP_API_KEY       API key (uses securitySchemes from spec to determine header)
  API2MCP_BEARER_TOKEN  Bearer token (adds Authorization: Bearer header)

  Legacy aliases: OPENAPI_SPEC_URL, OPENAPI_API_KEY, OPENAPI_BEARER_TOKEN

Examples:
  $ api-to-mcp rest https://api.example.com/openapi.yaml
  $ api-to-mcp rest ./openapi.yaml -H "X-API-Key: pk_xxx"
  $ api-to-mcp rest https://api.example.com/openapi.yaml --readonly
  $ API2MCP_SPEC_URL=https://api.example.com/openapi.yaml api-to-mcp rest`)
    .action(async (specArg: string | undefined, opts: { header: string[]; readonly?: boolean }) => {
      const specSource = specArg || process.env.API2MCP_SPEC_URL || process.env.OPENAPI_SPEC_URL;

      if (!specSource) {
        process.stderr.write(chalk.red("Error: no spec source provided. Pass as argument or set API2MCP_SPEC_URL.\n"));
        process.exit(1);
      }

      const readonly = opts.readonly ?? false;

      const spec = await loadSpec(specSource);
      const serverName = spec.info.title || "api-to-mcp";
      const serverVersion = spec.info.version || "0.1.0";

      const tools = filterTools(buildTools(spec), { readonly });

      const baseUrl = resolveBaseUrl(spec.servers?.[0]?.url, specSource);
      const authHeaders = resolveAuthHeaders(spec, {
        cliHeaders: parseHeaderFlags(opts.header),
        env: process.env,
      });

      await startMcpServer({
        serverName,
        serverVersion,
        tools,
        specSource,
        baseUrl,
        readonly,
        executeCall: (tool, args) => executeToolCall(tool, args, baseUrl, authHeaders),
      });
    });
}
