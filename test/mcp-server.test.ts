import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks (hoisted so vi.mock factories can reference them) ---
const { mockSetRequestHandler, mockConnect } = vi.hoisted(() => ({
  mockSetRequestHandler: vi.fn(),
  mockConnect: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@modelcontextprotocol/sdk/server/index.js", () => ({
  Server: vi.fn(() => ({ setRequestHandler: mockSetRequestHandler, connect: mockConnect })),
}));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: vi.fn(() => ({})),
}));
vi.mock("@modelcontextprotocol/sdk/types.js", () => ({
  CallToolRequestSchema: "CallToolRequestSchema",
  ListToolsRequestSchema: "ListToolsRequestSchema",
}));

import { startMcpServer, type McpServerOptions } from "../src/mcp-server.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const baseTool = {
  name: "get_item",
  description: "Get an item",
  method: "GET" as const,
  path: "/items/{id}",
  inputSchema: { type: "object" as const, properties: { id: { type: "string" } }, required: ["id"] },
};

function makeOpts(overrides: Partial<McpServerOptions> = {}): McpServerOptions {
  return {
    serverName: "Test API",
    serverVersion: "1.0.0",
    tools: [baseTool],
    specSource: "https://example.com/spec.yaml",
    baseUrl: "https://example.com",
    readonly: false,
    executeCall: vi.fn().mockResolvedValue({ content: "ok", isError: false }),
    ...overrides,
  };
}

describe("startMcpServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
  });

  it("creates server and connects transport", async () => {
    await startMcpServer(makeOpts());
    expect(Server).toHaveBeenCalledWith(
      { name: "Test API", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );
    expect(StdioServerTransport).toHaveBeenCalled();
    expect(mockConnect).toHaveBeenCalled();
  });

  it("registers ListTools and CallTool handlers", async () => {
    await startMcpServer(makeOpts());
    expect(mockSetRequestHandler).toHaveBeenCalledTimes(2);
    expect(mockSetRequestHandler).toHaveBeenCalledWith("ListToolsRequestSchema", expect.any(Function));
    expect(mockSetRequestHandler).toHaveBeenCalledWith("CallToolRequestSchema", expect.any(Function));
  });

  it("ListTools handler returns tool list", async () => {
    await startMcpServer(makeOpts());
    const listHandler = mockSetRequestHandler.mock.calls.find(
      ([schema]) => schema === "ListToolsRequestSchema"
    )![1];
    const result = await listHandler();
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe("get_item");
  });

  it("CallTool handler invokes executeCall and returns result", async () => {
    const executeCall = vi.fn().mockResolvedValue({ content: "item data", isError: false });
    await startMcpServer(makeOpts({ executeCall }));
    const callHandler = mockSetRequestHandler.mock.calls.find(
      ([schema]) => schema === "CallToolRequestSchema"
    )![1];
    const result = await callHandler({ params: { name: "get_item", arguments: { id: "42" } } });
    expect(executeCall).toHaveBeenCalledWith(baseTool, { id: "42" });
    expect(result.content[0].text).toBe("item data");
    expect(result.isError).toBe(false);
  });

  it("CallTool handler returns error for unknown tool", async () => {
    await startMcpServer(makeOpts());
    const callHandler = mockSetRequestHandler.mock.calls.find(
      ([schema]) => schema === "CallToolRequestSchema"
    )![1];
    const result = await callHandler({ params: { name: "unknown_tool", arguments: {} } });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Unknown tool/);
  });

  it("CallTool handler catches Error thrown by executeCall", async () => {
    const executeCall = vi.fn().mockRejectedValue(new Error("network failure"));
    await startMcpServer(makeOpts({ executeCall }));
    const callHandler = mockSetRequestHandler.mock.calls.find(
      ([schema]) => schema === "CallToolRequestSchema"
    )![1];
    const result = await callHandler({ params: { name: "get_item", arguments: {} } });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/network failure/);
  });

  it("CallTool handler catches non-Error thrown by executeCall", async () => {
    const executeCall = vi.fn().mockRejectedValue("raw string error");
    await startMcpServer(makeOpts({ executeCall }));
    const callHandler = mockSetRequestHandler.mock.calls.find(
      ([schema]) => schema === "CallToolRequestSchema"
    )![1];
    const result = await callHandler({ params: { name: "get_item", arguments: {} } });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/raw string error/);
  });

  it("CallTool handler handles null arguments", async () => {
    const executeCall = vi.fn().mockResolvedValue({ content: "ok", isError: false });
    await startMcpServer(makeOpts({ executeCall }));
    const callHandler = mockSetRequestHandler.mock.calls.find(
      ([schema]) => schema === "CallToolRequestSchema"
    )![1];
    await callHandler({ params: { name: "get_item", arguments: null } });
    expect(executeCall).toHaveBeenCalledWith(baseTool, {});
  });

  it("prints readonly badge when readonly=true", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await startMcpServer(makeOpts({ readonly: true }));
    const output = stderr.mock.calls.map((c) => c[0]).join("");
    expect(output).toMatch(/readonly/);
    stderr.mockRestore();
  });

  it("does not print readonly badge when readonly=false", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await startMcpServer(makeOpts({ readonly: false }));
    const output = stderr.mock.calls.map((c) => c[0]).join("");
    expect(output).not.toMatch(/readonly/);
    stderr.mockRestore();
  });
});
