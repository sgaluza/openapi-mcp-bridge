import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import chalk from "chalk";
import type { ToolDefinition } from "./tool-builder.js";

export interface McpServerOptions {
  serverName: string;
  serverVersion: string;
  tools: ToolDefinition[];
  specSource: string;
  baseUrl: string;
  readonly: boolean;
  executeCall: (
    tool: ToolDefinition,
    args: Record<string, unknown>
  ) => Promise<{ content: string; isError: boolean }>;
}

/**
 * Start an MCP stdio server with the given tools and execution handler.
 */
export async function startMcpServer(opts: McpServerOptions): Promise<void> {
  const { serverName, serverVersion, tools, specSource, baseUrl, readonly, executeCall } = opts;

  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

  const server = new Server(
    { name: serverName, version: serverVersion },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = toolMap.get(name);

    if (!tool) {
      return {
        content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    let result: { content: string; isError: boolean };
    try {
      result = await executeCall(tool, (args ?? {}) as Record<string, unknown>);
    } catch (error) {
      result = {
        content: `Internal error: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
    return {
      content: [{ type: "text" as const, text: result.content }],
      isError: result.isError,
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const readonlyBadge = readonly ? chalk.yellow(" [readonly]") : "";
  process.stderr.write(
    chalk.green("✓") + ` ${chalk.bold(serverName)} v${serverVersion}${readonlyBadge}\n` +
    chalk.cyan("⚡") + ` ${tools.length} tools loaded from ${chalk.dim(specSource)}\n` +
    chalk.cyan("🌐") + ` Base URL: ${chalk.dim(baseUrl)}\n`
  );
}
