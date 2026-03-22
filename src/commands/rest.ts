import type { Command } from "commander";
import chalk from "chalk";
import { loadSpec } from "../spec-loader.js";
import { buildTools, filterTools } from "../tool-builder.js";
import { executeToolCall, resolveBaseUrl } from "../executor.js";
import { resolveAuthHeaders, parseHeaderFlags } from "../auth.js";
import { startMcpServer } from "../mcp-server.js";

const collect = (val: string, acc: string[]) => [...acc, val];
const splitCsv = (val: string) => val.split(",").map((s) => s.trim()).filter(Boolean);

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
    .option("--only <operations>", "Whitelist operations by name, comma-separated")
    .option("--exclude <operations>", "Blacklist operations by name, comma-separated")
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
  $ api-to-mcp rest spec.yaml --only "getIssue,listIssues"
  $ api-to-mcp rest spec.yaml --exclude "deleteIssue,archiveProject"
  $ API2MCP_SPEC_URL=https://api.example.com/openapi.yaml api-to-mcp rest`)
    .action(async (specArg: string | undefined, opts: { header: string[]; readonly?: boolean; only?: string; exclude?: string }) => {
      const specSource = specArg || process.env.API2MCP_SPEC_URL || process.env.OPENAPI_SPEC_URL;

      if (!specSource) {
        process.stderr.write(chalk.red("Error: no spec source provided. Pass as argument or set API2MCP_SPEC_URL.\n"));
        process.exit(1);
      }

      if (opts.only && opts.exclude) {
        process.stderr.write(chalk.red("Error: --only and --exclude are mutually exclusive.\n"));
        process.exit(1);
      }

      const readonly = opts.readonly ?? false;
      const only = opts.only ? splitCsv(opts.only) : undefined;
      const exclude = opts.exclude ? splitCsv(opts.exclude) : undefined;

      const spec = await loadSpec(specSource);
      const serverName = spec.info.title || "api-to-mcp";
      const serverVersion = spec.info.version || "0.1.0";

      const allTools = buildTools(spec);
      const tools = filterTools(allTools, { readonly, only, exclude });

      if (only) {
        const toolNames = new Set(allTools.map((t) => t.name));
        const unknown = only.filter((name) => !toolNames.has(name));
        if (unknown.length > 0) {
          process.stderr.write(chalk.yellow(`Warning: unknown operations in --only: ${unknown.join(", ")}\n`));
        }
      }

      if (tools.length === 0) {
        process.stderr.write(chalk.red("Error: no tools remaining after filtering. Check --only/--exclude/--readonly flags.\n"));
        process.exit(1);
      }

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
