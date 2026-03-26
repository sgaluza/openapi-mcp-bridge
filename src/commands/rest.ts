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
import { SPEC_OPTION, SHARED_OPTIONS, AUTH_OPTIONS, resolveOption, registerOptions, findSharedOption } from "../options-schema.js";
import { buildJwtAuth } from "./jwt-auth-options.js";

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
  API2MCP_READONLY      Expose only read operations (same as --readonly)
  API2MCP_ONLY          Whitelist operations, comma-separated (same as --only)
  API2MCP_EXCLUDE       Blacklist operations, comma-separated (same as --exclude)
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
  $ API2MCP_SPEC_URL=https://api.example.com/openapi.yaml api-to-mcp rest
  $ api-to-mcp rest spec.yaml --auth-type jwt-password \\
      --auth-login-url https://api.example.com/auth/login \\
      --auth-username-field userName --auth-token-path jwt

JWT password auth env vars:
  API2MCP_AUTH_TYPE            Auth type: jwt-password
  API2MCP_AUTH_LOGIN_URL       Login endpoint URL
  API2MCP_AUTH_USERNAME_FIELD  Request body field for username (default: username)
  API2MCP_AUTH_PASSWORD_FIELD  Request body field for password (default: password)
  API2MCP_AUTH_TOKEN_PATH      Dot-path to JWT in login response (default: token)
  API2MCP_AUTH_REFRESH_URL     Refresh endpoint (optional — default: re-login on expiry)
  API2MCP_USERNAME             Username for jwt-password auth
  API2MCP_PASSWORD             Password for jwt-password auth`);

  registerOptions(cmd, SHARED_OPTIONS);
  registerOptions(cmd, AUTH_OPTIONS);

  cmd.action(async (specArg: string | undefined, opts: {
    header: string[];
    readonly?: boolean;
    only?: string;
    exclude?: string;
    bind: string[];
    config?: string;
    authType?: string;
    authLoginUrl?: string;
    authUsernameField?: string;
    authPasswordField?: string;
    authTokenPath?: string;
    authRefreshUrl?: string;
  }) => {
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
      const staticAuthHeaders = {
        ...(configFile?.auth?.headers ?? {}),
        ...resolveAuthHeaders(spec, {
          cliHeaders: parseHeaderFlags(opts.header),
          env: mergedEnv,
        }),
      };

      const jwtAuth = buildJwtAuth(opts, configFile, process.env);

      await startMcpServer({
        serverName,
        serverVersion,
        tools,
        specSource,
        baseUrl,
        readonly,
        executeCall: async (tool, args) => {
          const jwtHeaders = jwtAuth ? await jwtAuth.getHeaders() : {};
          const headers = { ...staticAuthHeaders, ...jwtHeaders };
          const result = await executeToolCall(tool, { ...args, ...bindings }, baseUrl, headers);
          // On 401, force-refresh JWT and retry once
          if (result.isError && result.httpStatus === 401 && jwtAuth) {
            const freshHeaders = await jwtAuth.getHeaders(true);
            return executeToolCall(tool, { ...args, ...bindings }, baseUrl, { ...staticAuthHeaders, ...freshHeaders });
          }
          return result;
        },
      });
    });
}
