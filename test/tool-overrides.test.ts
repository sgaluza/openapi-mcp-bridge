import { describe, it, expect } from "vitest";
import { applyOverrides, collectEnvOverrides } from "../src/tool-builder.js";
import type { ToolDefinition } from "../src/tool-builder.js";

const makeTool = (name: string, description: string): ToolDefinition => ({
  name,
  description,
  inputSchema: { type: "object", properties: {}, required: [] },
  method: "GET",
  pathTemplate: `/${name}`,
  pathParams: [],
  queryParams: [],
  hasBody: false,
});

describe("collectEnvOverrides", () => {
  it("extracts overrides from API2MCP_OVERRIDE_ prefixed env vars", () => {
    const result = collectEnvOverrides({
      API2MCP_OVERRIDE_getFoo: "new description",
      API2MCP_OVERRIDE_getBar: "bar description",
    });
    expect(result).toEqual({ getFoo: "new description", getBar: "bar description" });
  });

  it("ignores env vars without the prefix", () => {
    const result = collectEnvOverrides({
      API2MCP_READONLY: "true",
      SOME_OTHER_VAR: "value",
      API2MCP_OVERRIDE_getFoo: "desc",
    });
    expect(result).toEqual({ getFoo: "desc" });
  });

  it("ignores empty string values", () => {
    const result = collectEnvOverrides({ API2MCP_OVERRIDE_getFoo: "" });
    expect(result).toEqual({});
  });

  it("ignores undefined values", () => {
    const result = collectEnvOverrides({ API2MCP_OVERRIDE_getFoo: undefined });
    expect(result).toEqual({});
  });

  it("returns empty object when no matching env vars", () => {
    const result = collectEnvOverrides({ PATH: "/usr/bin", HOME: "/home/user" });
    expect(result).toEqual({});
  });
});

describe("applyOverrides", () => {
  it("overrides description for a matching tool", () => {
    const tools = [makeTool("getFoo", "original")];
    const result = applyOverrides(tools, { getFoo: "new description" });
    expect(result[0].description).toBe("new description");
  });

  it("leaves non-matching tools unchanged", () => {
    const tools = [makeTool("getFoo", "original"), makeTool("getBar", "bar desc")];
    const result = applyOverrides(tools, { getFoo: "new" });
    expect(result[1].description).toBe("bar desc");
  });

  it("ignores overrides for tool names that do not exist", () => {
    const tools = [makeTool("getFoo", "original")];
    expect(() => applyOverrides(tools, { nonExistent: "desc" })).not.toThrow();
    expect(result => result).toBeDefined();
    const result = applyOverrides(tools, { nonExistent: "desc" });
    expect(result[0].description).toBe("original");
  });

  it("returns original array unchanged when overrides is empty", () => {
    const tools = [makeTool("getFoo", "original")];
    const result = applyOverrides(tools, {});
    expect(result).toBe(tools);
  });

  it("does not mutate the original tool objects", () => {
    const tools = [makeTool("getFoo", "original")];
    applyOverrides(tools, { getFoo: "new" });
    expect(tools[0].description).toBe("original");
  });

  it("overrides multiple tools at once", () => {
    const tools = [makeTool("getFoo", "foo"), makeTool("getBar", "bar")];
    const result = applyOverrides(tools, { getFoo: "new foo", getBar: "new bar" });
    expect(result[0].description).toBe("new foo");
    expect(result[1].description).toBe("new bar");
  });
});
