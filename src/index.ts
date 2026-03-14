import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadSpec } from "./spec-loader.js";
import { buildTools, type ToolDefinition } from "./tool-builder.js";
import { executeToolCall, resolveBaseUrl } from "./executor.js";
import { resolveAuthHeaders, parseHeaderFlags } from "./auth.js";

/**
 * Parse CLI arguments.
 * Usage: openapi-mcp-bridge <spec-url-or-path> [--header "Name: Value"]...
 */
function parseArgs(argv: string[]): {
  specSource: string;
  headers: string[];
} {
  const args = argv.slice(2);
  if (args[0] === "--help" || args[0] === "-h") {
    console.error(
      `Usage: @sgaluza/openapi-mcp-bridge <openapi-spec-url-or-path> [--header "Name: Value"]...

Options:
  --header, -H    Add a custom header to all API requests (repeatable)

Environment variables:
  OPENAPI_SPEC_URL      OpenAPI spec URL or path (alternative to positional arg)
  OPENAPI_API_KEY       API key (uses securitySchemes from spec to determine header)
  OPENAPI_BEARER_TOKEN  Bearer token (adds Authorization: Bearer header)

Examples:
  npx @sgaluza/openapi-mcp-bridge https://api.example.com/openapi.yaml
  npx @sgaluza/openapi-mcp-bridge ./openapi.yaml --header "X-API-Key: pk_xxx"
  OPENAPI_SPEC_URL=https://api.example.com/openapi.yaml npx @sgaluza/openapi-mcp-bridge`
    );
    process.exit(0);
  }

  const specSource = args[0] || process.env.OPENAPI_SPEC_URL;
  if (!specSource) {
    console.error(
      "Error: No spec source provided. Pass as argument or set OPENAPI_SPEC_URL env var."
    );
    process.exit(1);
  }
  const headers: string[] = [];

  let i = 1;
  while (i < args.length) {
    if (args[i] === "--header" || args[i] === "-H") {
      i++;
      if (i >= args.length) {
        console.error("Error: --header requires a value");
        process.exit(1);
      }
      headers.push(args[i]);
    } else {
      console.error(`Unknown argument: ${args[i]}`);
      process.exit(1);
    }
    i++;
  }

  return { specSource, headers };
}

async function main() {
  const { specSource, headers } = parseArgs(process.argv);

  // Load and parse the OpenAPI spec
  const spec = await loadSpec(specSource);
  const serverName = spec.info.title || "openapi-mcp-bridge";
  const serverVersion = spec.info.version || "0.1.0";

  // Build tool definitions from the spec
  const tools = buildTools(spec);
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

  // Log to stderr (stdout is used for MCP protocol)
  console.error(
    `${serverName} v${serverVersion} — ${tools.length} tools loaded from ${specSource}`
  );
  console.error(`Base URL: ${baseUrl}`);
}

main().catch((error) => {
  console.error("Fatal error:", error.message || error);
  process.exit(1);
});
