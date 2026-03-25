import type { Command } from "commander";
import chalk from "chalk";
import { loadSpec } from "../spec-loader.js";
import { buildTools, filterTools, applyBindings } from "../tool-builder.js";
import { executeToolCall, resolveBaseUrl } from "../executor.js";
import { resolveAuthHeaders, parseHeaderFlags } from "../auth.js";
import { startMcpServer } from "../mcp-server.js";
import { resolveFilterOptions } from "./filter-options.js";
import { parseBindings } from "./bind-options.js";
import { loadConfigFile, mergeEnvWithConfig } from "../config-file.js";

const collect = (val: string, acc: string[]) => [...acc, val];

/** Register the `rest` subcommand onto the given commander program. */
export function registerRestCommand(program: Command): void {
  program
    .command("rest")
    .description("Start an MCP server from an OpenAPI spec")
    .argument("[spec]", "OpenAPI spec URL or file path")
    .option("-H, --header <header>", "Add a request header (repeatable)", collect, [])
    .option("--readonly", "Expose only read-only operations (GET/HEAD)")
    .option("--only <operations>", "Whitelist operations by name, comma-separated")
    .option("--exclude <operations>", "Blacklist operations by name, comma-separated")
    .option("--bind <binding>", "Pre-bind a parameter to a fixed value: key=value (repeatable)", collect, [])
    .option("--config <path>", "Path to config file (default: auto-discover api-to-mcp.yml/yaml/json)")
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
  $ api-to-mcp rest spec.yaml --bind "teamId=TEAM_ABC" --bind "projectId=PROJ_XYZ"
  $ API2MCP_SPEC_URL=https://api.example.com/openapi.yaml api-to-mcp rest`)
    .action(async (specArg: string | undefined, opts: { header: string[]; readonly?: boolean; only?: string; exclude?: string; bind: string[]; config?: string }) => {
      const configFile = loadConfigFile(opts.config);
      const specSource = specArg || process.env.API2MCP_SPEC_URL || process.env.OPENAPI_SPEC_URL || configFile?.spec;

      if (!specSource) {
        process.stderr.write(chalk.red("Error: no spec source provided. Pass as argument or set API2MCP_SPEC_URL.\n"));
        process.exit(1);
      }

      const readonly = opts.readonly ?? configFile?.options?.readonly ?? false;
      const bindings = { ...(configFile?.options?.bind ?? {}), ...parseBindings(opts.bind) };

      const spec = await loadSpec(specSource);
      const serverName = spec.info.title || "api-to-mcp";
      const serverVersion = spec.info.version || "0.1.0";

      const allTools = buildTools(spec);

      // Warn if any binding key does not match a parameter in any tool
      const allParamNames = new Set(allTools.flatMap((t) => Object.keys(t.inputSchema.properties)));
      for (const key of Object.keys(bindings)) {
        if (!allParamNames.has(key)) {
          process.stderr.write(chalk.yellow(`Warning: --bind key '${key}' not found in any tool. Check for typos.\n`));
        }
      }

      const bound = applyBindings(allTools, bindings);
      const mergedOpts = {
        only: opts.only ?? configFile?.options?.only?.join(","),
        exclude: opts.exclude ?? configFile?.options?.exclude?.join(","),
      };
      const { only, exclude } = resolveFilterOptions(mergedOpts, bound);
      const tools = filterTools(bound, { readonly, only, exclude });

      if (tools.length === 0) {
        const applied = [
          readonly && "readonly",
          opts.only && `only=${opts.only}`,
          opts.exclude && `exclude=${opts.exclude}`,
          Object.keys(bindings).length > 0 && `bind=[${Object.keys(bindings).join(", ")}]`,
        ].filter(Boolean).join(", ");
        process.stderr.write(chalk.red(
          `Error: no tools remaining after filtering (had ${allTools.length} tools before filters).\n` +
          `Applied filters: ${applied}\n`
        ));
        process.exit(1);
      }

      const baseUrl = resolveBaseUrl(spec.servers?.[0]?.url, specSource);
      const mergedEnv = mergeEnvWithConfig(process.env, configFile?.auth);
      const authHeaders = resolveAuthHeaders(spec, {
        cliHeaders: { ...(configFile?.auth?.headers ?? {}), ...parseHeaderFlags(opts.header) },
        env: mergedEnv,
      });

      await startMcpServer({
        serverName,
        serverVersion,
        tools,
        specSource,
        baseUrl,
        readonly,
        executeCall: (tool, args) => executeToolCall(tool, { ...args, ...bindings }, baseUrl, authHeaders),
      });
    });
}
