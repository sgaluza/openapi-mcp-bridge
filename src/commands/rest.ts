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
import { SPEC_OPTION, resolveOption, registerOptions, findSharedOption } from "../options-schema.js";

const collect = (val: string, acc: string[]) => [...acc, val];

/** Register the `rest` subcommand onto the given commander program. */
export function registerRestCommand(program: Command): void {
  const cmd = program
    .command("rest")
    .description("Start an MCP server from an OpenAPI spec")
    .argument("[spec]", "OpenAPI spec URL or file path")
    .option("-H, --header <header>", "Add a request header (repeatable)", collect, [])
    .option("--bind <binding>", "Pre-bind a parameter to a fixed value: key=value (repeatable)", collect, [])
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
  $ API2MCP_SPEC_URL=https://api.example.com/openapi.yaml api-to-mcp rest`);

  registerOptions(cmd, SHARED_OPTIONS);

  cmd.action(async (specArg: string | undefined, opts: { header: string[]; readonly?: boolean; only?: string; exclude?: string; bind: string[]; config?: string }) => {
      const configFile = loadConfigFile(opts.config);
      const specSource = resolveOption(SPEC_OPTION, specArg, process.env, configFile);

      if (!specSource) {
        process.stderr.write(chalk.red("Error: no spec source provided. Pass as argument or set API2MCP_SPEC_URL.\n"));
        process.exit(1);
      }

      const readonly = resolveOption(findSharedOption("readonly"), opts.readonly, process.env, configFile) ?? false;
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
        only: resolveOption(findSharedOption("only"), opts.only, process.env, configFile),
        exclude: resolveOption(findSharedOption("exclude"), opts.exclude, process.env, configFile),
      };
      const { only, exclude } = resolveFilterOptions(mergedOpts, bound);
      const tools = filterTools(bound, { readonly, only, exclude });

      if (tools.length === 0) {
        const applied = [
          readonly && "readonly",
          mergedOpts.only && `only=${mergedOpts.only}`,
          mergedOpts.exclude && `exclude=${mergedOpts.exclude}`,
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
      const authHeaders = {
        ...(configFile?.auth?.headers ?? {}),
        ...resolveAuthHeaders(spec, {
          cliHeaders: parseHeaderFlags(opts.header),
          env: mergedEnv,
        }),
      };

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
