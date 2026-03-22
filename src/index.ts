import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Command } from "commander";
import chalk from "chalk";
import { loadSpec } from "./spec-loader.js";
import { buildTools, filterTools, type ToolDefinition } from "./tool-builder.js";
import { executeToolCall, resolveBaseUrl } from "./executor.js";
import { resolveAuthHeaders, parseHeaderFlags } from "./auth.js";

function parseCli(argv: string[]): {
  specSource: string;
  headers: string[];
  readonly: boolean;
} {
  const program = new Command();

  program
    .name("api-to-mcp")
    .description("Turn any API (OpenAPI, GraphQL coming soon) into an MCP server via stdio bridge.")
    .argument("[spec]", "API spec URL or file path")
    .option("-H, --header <header>", "Add a request header (repeatable)", (val, acc: string[]) => [...acc, val], [])
    .option("--readonly", "Expose only read-only operations (GET/HEAD)")
    .addHelpText("after", `
Environment variables:
  API2MCP_SPEC_URL      API spec URL or path (alternative to positional arg)
  API2MCP_API_KEY       API key (uses securitySchemes from spec to determine header)
  API2MCP_BEARER_TOKEN  Bearer token (adds Authorization: Bearer header)

  Legacy aliases: OPENAPI_SPEC_URL, OPENAPI_API_KEY, OPENAPI_BEARER_TOKEN

Examples:
  $ npx @sgaluza/api-to-mcp https://api.example.com/openapi.yaml
  $ npx @sgaluza/api-to-mcp ./openapi.yaml -H "X-API-Key: pk_xxx"
  $ npx @sgaluza/api-to-mcp https://api.example.com/openapi.yaml --readonly
  $ API2MCP_SPEC_URL=https://api.example.com/openapi.yaml npx @sgaluza/api-to-mcp`);

  program.parse(argv);

  const opts = program.opts<{ header: string[]; readonly?: boolean }>();
  const specSource = program.args[0] || process.env.API2MCP_SPEC_URL || process.env.OPENAPI_SPEC_URL;

  if (!specSource) {
    process.stderr.write(chalk.red("Error: no spec source provided. Pass as argument or set API2MCP_SPEC_URL.\n"));
    process.exit(1);
  }

  return {
    specSource,
    headers: opts.header,
    readonly: !!opts.readonly,
  };
}

async function main() {
  const { specSource, headers, readonly } = parseCli(process.argv);

  // Load and parse the API spec
  const spec = await loadSpec(specSource);
  const serverName = spec.info.title || "api-to-mcp";
  const serverVersion = spec.info.version || "0.1.0";

  // Build and filter tool definitions from the spec
  const tools = filterTools(buildTools(spec), { readonly });
  const toolMap = new Map<string, ToolDefinition>();
  for (const tool of tools) {
    toolMap.set(tool.name, tool);
  }

  // Resolve base URL and auth
  const baseUrl = resolveBaseUrl(spec.servers?.[0]?.url, specSource);
  const authHeaders = resolveAuthHeaders(spec, {
    cliHeaders: parseHeaderFlags(headers),
    env: process.env,
  });

  // Create MCP server
  const server = new Server(
    { name: serverName, version: serverVersion },
    { capabilities: { tools: {} } }
  );

  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = toolMap.get(name);

    if (!tool) {
      return {
        content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    const result = await executeToolCall(
      tool,
      (args ?? {}) as Record<string, unknown>,
      baseUrl,
      authHeaders
    );

    return {
      content: [{ type: "text" as const, text: result.content }],
      isError: result.isError,
    };
  });

  // Start the stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log startup info to stderr (stdout is reserved for MCP protocol)
  const readonlyBadge = readonly ? chalk.yellow(" [readonly]") : "";
  process.stderr.write(
    chalk.green("✓") + ` ${chalk.bold(serverName)} v${serverVersion}${readonlyBadge}\n` +
    chalk.cyan("⚡") + ` ${tools.length} tools loaded from ${chalk.dim(specSource)}\n` +
    chalk.cyan("🌐") + ` Base URL: ${chalk.dim(baseUrl)}\n`
  );
}

main().catch((error) => {
  process.stderr.write(chalk.red("✗ Fatal error: ") + (error.message || error) + "\n");
  process.exit(1);
});
