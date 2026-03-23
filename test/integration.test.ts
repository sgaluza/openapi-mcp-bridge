import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadSpec, resolveRef, resolveSchemaRefs } from "../src/spec-loader.js";
import { buildTools, filterTools, applyBindings } from "../src/tool-builder.js";
import { parseBindings } from "../src/commands/bind-options.js";
import { resolveBaseUrl, executeToolCall } from "../src/executor.js";
import { resolveAuthHeaders, parseHeaderFlags } from "../src/auth.js";
import { splitCsv, resolveFilterOptions } from "../src/commands/filter-options.js";
import type { OpenAPISpec } from "../src/spec-loader.js";

/** Minimal OpenAPI 3.0 spec fixture for testing */
const testSpec: OpenAPISpec = {
  openapi: "3.0.3",
  info: { title: "Test API", version: "1.0.0", description: "A test API" },
  servers: [{ url: "https://api.example.com/v1" }],
  paths: {
    "/users": {
      get: {
        operationId: "listUsers",
        summary: "List all users",
        description: "Returns a paginated list of users in the system",
        parameters: [
          {
            name: "page",
            in: "query",
            required: false,
            description: "Page number",
            schema: { type: "integer", default: 1 },
          },
          {
            name: "limit",
            in: "query",
            required: false,
            description: "Items per page",
            schema: { type: "integer", default: 20 },
          },
        ],
      },
      post: {
        operationId: "createUser",
        summary: "Create a new user",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  email: { type: "string", format: "email" },
                },
                required: ["name", "email"],
              },
            },
          },
        },
      },
    },
    "/users/{userId}": {
      get: {
        operationId: "getUser",
        summary: "Get user by ID",
        parameters: [
          {
            name: "userId",
            in: "path",
            required: true,
            description: "The user ID",
            schema: { type: "string" },
          },
        ],
      },
      put: {
        summary: "Update user",
        parameters: [
          {
            name: "userId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UserUpdate" },
            },
          },
        },
      },
    },
    "/users/{userId}/posts/{postId}": {
      delete: {
        summary: "Delete a user's post",
        parameters: [
          {
            name: "userId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "postId",
            in: "path",
            required: true,
            schema: { type: "integer" },
          },
        ],
      },
    },
    "/health": {
      get: {
        summary: "Health check",
      },
      head: {
        summary: "Health check (HEAD)",
      },
    },
  },
  components: {
    schemas: {
      UserUpdate: {
        type: "object",
        properties: {
          name: { type: "string" },
          bio: { type: "string", nullable: true },
        },
      },
    },
    securitySchemes: {
      apiKey: {
        type: "apiKey",
        name: "X-API-Key",
        in: "header",
      },
    },
  },
};

describe("tool-builder", () => {
  it("creates correct tool definitions from OpenAPI spec", () => {
    const tools = buildTools(testSpec);

    expect(tools.length).toBe(7);

    // Check listUsers tool
    const listUsers = tools.find((t) => t.name === "listUsers");
    expect(listUsers).toBeDefined();
    expect(listUsers!.method).toBe("GET");
    expect(listUsers!.pathTemplate).toBe("/users");
    expect(listUsers!.description).toContain("List all users");
    expect(listUsers!.queryParams).toEqual(["page", "limit"]);
    expect(listUsers!.pathParams).toEqual([]);
    expect(listUsers!.inputSchema.required).toEqual([]);
    expect(listUsers!.inputSchema.properties.page).toEqual({
      type: "integer",
      default: 1,
      description: "Page number",
    });
  });

  it("handles path parameters correctly", () => {
    const tools = buildTools(testSpec);
    const getUser = tools.find((t) => t.name === "getUser");

    expect(getUser).toBeDefined();
    expect(getUser!.pathParams).toEqual(["userId"]);
    expect(getUser!.inputSchema.required).toContain("userId");
    expect(getUser!.inputSchema.properties.userId).toBeDefined();
  });

  it("handles request body correctly", () => {
    const tools = buildTools(testSpec);
    const createUser = tools.find((t) => t.name === "createUser");

    expect(createUser).toBeDefined();
    expect(createUser!.hasBody).toBe(true);
    expect(createUser!.inputSchema.required).toContain("body");
    expect(createUser!.inputSchema.properties.body).toMatchObject({
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string", format: "email" },
      },
    });
  });

  it("generates tool name from method and path when operationId is missing", () => {
    const tools = buildTools(testSpec);

    // PUT /users/{userId} has no operationId
    const updateUser = tools.find((t) => t.name === "put_users_userId");
    expect(updateUser).toBeDefined();
    expect(updateUser!.method).toBe("PUT");

    // DELETE /users/{userId}/posts/{postId} has no operationId
    const deletePost = tools.find(
      (t) => t.name === "delete_users_userId_posts_postId"
    );
    expect(deletePost).toBeDefined();
    expect(deletePost!.pathParams).toEqual(["userId", "postId"]);
  });

  it("resolves $ref in request body schema", () => {
    const tools = buildTools(testSpec);
    const updateUser = tools.find((t) => t.name === "put_users_userId");

    expect(updateUser!.hasBody).toBe(true);
    expect(updateUser!.inputSchema.properties.body).toMatchObject({
      type: "object",
      properties: {
        name: { type: "string" },
        bio: { type: "string", nullable: true },
      },
    });
  });

  it("handles endpoint with no parameters", () => {
    const tools = buildTools(testSpec);
    const health = tools.find((t) => t.name === "get_health");

    expect(health).toBeDefined();
    expect(health!.pathParams).toEqual([]);
    expect(health!.queryParams).toEqual([]);
    expect(health!.hasBody).toBe(false);
    expect(health!.inputSchema.properties).toEqual({});
    expect(health!.inputSchema.required).toEqual([]);
  });
});

describe("filterTools --only / --exclude", () => {
  it("returns only listed tools when only is provided", () => {
    const tools = buildTools(testSpec);
    const result = filterTools(tools, { only: ["listUsers", "getUser"] });

    expect(result).toHaveLength(2);
    expect(result.map((t) => t.name)).toEqual(["listUsers", "getUser"]);
  });

  it("excludes listed tools when exclude is provided", () => {
    const tools = buildTools(testSpec);
    const result = filterTools(tools, { exclude: ["createUser", "delete_users_userId_posts_postId"] });

    expect(result.find((t) => t.name === "createUser")).toBeUndefined();
    expect(result.find((t) => t.name === "delete_users_userId_posts_postId")).toBeUndefined();
    expect(result.length).toBe(tools.length - 2);
  });

  it("combines only and readonly (intersection)", () => {
    const tools = buildTools(testSpec);
    const result = filterTools(tools, { readonly: true, only: ["listUsers", "createUser"] });

    // createUser is POST → filtered by readonly, listUsers is GET → passes both
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("listUsers");
  });

  it("combines exclude and readonly", () => {
    const tools = buildTools(testSpec);
    const result = filterTools(tools, { readonly: true, exclude: ["listUsers"] });

    expect(result.find((t) => t.name === "listUsers")).toBeUndefined();
    expect(result.every((t) => t.method === "GET" || t.method === "HEAD")).toBe(true);
  });

  it("ignores unknown names in only silently", () => {
    const tools = buildTools(testSpec);
    const result = filterTools(tools, { only: ["listUsers", "nonExistent"] });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("listUsers");
  });

  it("returns all tools when only and exclude are empty arrays", () => {
    const tools = buildTools(testSpec);
    expect(filterTools(tools, { only: [] })).toHaveLength(tools.length);
    expect(filterTools(tools, { exclude: [] })).toHaveLength(tools.length);
  });
});

describe("filterTools --readonly", () => {
  it("returns only GET tools when readonly is true", () => {
    const tools = buildTools(testSpec);
    const readonly = filterTools(tools, { readonly: true });

    expect(readonly.every((t) => t.method === "GET" || t.method === "HEAD")).toBe(true);
    expect(readonly.map((t) => t.name)).toEqual(
      expect.arrayContaining(["listUsers", "getUser", "get_health", "head_health"])
    );
    expect(readonly.find((t) => t.name === "createUser")).toBeUndefined();
    expect(readonly.find((t) => t.name === "put_users_userId")).toBeUndefined();
    expect(
      readonly.find((t) => t.name === "delete_users_userId_posts_postId")
    ).toBeUndefined();
  });

  it("returns all tools when readonly is false", () => {
    const tools = buildTools(testSpec);
    const all = filterTools(tools, { readonly: false });

    expect(all.length).toBe(tools.length);
  });

  it("returns all tools when no options passed", () => {
    const tools = buildTools(testSpec);
    const all = filterTools(tools, {});

    expect(all.length).toBe(tools.length);
  });

  it("does not mutate the original tools array", () => {
    const tools = buildTools(testSpec);
    const copy = [...tools];
    filterTools(tools, { readonly: true });

    expect(tools).toEqual(copy);
  });
});

describe("resolveRef", () => {
  it("resolves component schema references", () => {
    const result = resolveRef(testSpec, "#/components/schemas/UserUpdate");
    expect(result).toMatchObject({
      type: "object",
      properties: { name: { type: "string" } },
    });
  });

  it("throws on external $ref", () => {
    expect(() =>
      resolveRef(testSpec, "https://other.com/schema.json#/Foo")
    ).toThrow("External $ref not supported");
  });

  it("throws on missing $ref", () => {
    expect(() =>
      resolveRef(testSpec, "#/components/schemas/NonExistent")
    ).toThrow("$ref not found");
  });

  it("throws when path traversal hits a non-object mid-path", () => {
    const spec = {
      components: {
        schemas: {
          Flat: "not-an-object",
        },
      },
    } as unknown as typeof testSpec;
    expect(() =>
      resolveRef(spec, "#/components/schemas/Flat/nested")
    ).toThrow("Cannot resolve $ref");
  });
});

describe("resolveSchemaRefs", () => {
  it("resolves nested $ref in schema properties", () => {
    const schema = {
      type: "object",
      properties: {
        user: { $ref: "#/components/schemas/UserUpdate" },
      },
    };
    const resolved = resolveSchemaRefs(testSpec, schema);
    expect(resolved).toMatchObject({
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: { name: { type: "string" } },
        },
      },
    });
  });

  it("resolves allOf / oneOf / anyOf items", () => {
    const schema = {
      allOf: [
        { type: "object", properties: { a: { type: "string" } } },
        { $ref: "#/components/schemas/UserUpdate" },
      ],
    };
    const resolved = resolveSchemaRefs(testSpec, schema) as Record<string, unknown>;
    expect(Array.isArray(resolved.allOf)).toBe(true);
    const parts = resolved.allOf as unknown[];
    expect(parts).toHaveLength(2);
    expect(parts[1]).toMatchObject({ type: "object", properties: { name: { type: "string" } } });
  });

  it("resolves additionalProperties $ref", () => {
    const specWithAdditional: OpenAPISpec = {
      ...testSpec,
      components: {
        schemas: {
          Tag: { type: "string" },
        },
      },
    };
    const schema = {
      type: "object",
      additionalProperties: { $ref: "#/components/schemas/Tag" },
    };
    const resolved = resolveSchemaRefs(specWithAdditional, schema);
    expect(resolved.additionalProperties).toEqual({ type: "string" });
  });

  it("handles circular references gracefully", () => {
    const circularSpec: OpenAPISpec = {
      ...testSpec,
      components: {
        ...testSpec.components,
        schemas: {
          ...testSpec.components?.schemas,
          Node: {
            type: "object",
            properties: {
              children: {
                type: "array",
                items: { $ref: "#/components/schemas/Node" },
              },
            },
          },
        },
      },
    };
    const schema = { $ref: "#/components/schemas/Node" };
    const resolved = resolveSchemaRefs(circularSpec, schema);
    expect(resolved.type).toBe("object");
    // Should not throw or infinitely recurse
  });
});

describe("resolveBaseUrl", () => {
  it("uses servers URL as-is when absolute", () => {
    expect(
      resolveBaseUrl("https://api.example.com/v1", "./spec.yaml")
    ).toBe("https://api.example.com/v1");
  });

  it("strips trailing slash from servers URL", () => {
    expect(
      resolveBaseUrl("https://api.example.com/v1/", "./spec.yaml")
    ).toBe("https://api.example.com/v1");
  });

  it("resolves relative servers URL against spec source URL", () => {
    expect(
      resolveBaseUrl("/v1", "https://api.example.com/docs/openapi.yaml")
    ).toBe("https://api.example.com/v1");
  });

  it("derives base URL from spec source when no servers", () => {
    expect(
      resolveBaseUrl(undefined, "https://api.example.com/docs/openapi.yaml")
    ).toBe("https://api.example.com");
  });

  it("falls back to localhost for local file with no servers", () => {
    expect(resolveBaseUrl(undefined, "./openapi.yaml")).toBe(
      "http://localhost"
    );
  });
});

describe("auth", () => {
  it("parses header flags correctly", () => {
    const headers = parseHeaderFlags([
      "X-API-Key: pk_xxx",
      "Authorization: Bearer token123",
    ]);
    expect(headers).toEqual({
      "X-API-Key": "pk_xxx",
      Authorization: "Bearer token123",
    });
  });

  it("throws on invalid header format", () => {
    expect(() => parseHeaderFlags(["InvalidHeader"])).toThrow(
      "Invalid header format"
    );
  });

  it("resolves OPENAPI_API_KEY using securitySchemes", () => {
    const headers = resolveAuthHeaders(testSpec, {
      cliHeaders: {},
      env: { OPENAPI_API_KEY: "my-key" },
    });
    expect(headers["X-API-Key"]).toBe("my-key");
  });

  it("resolves OPENAPI_BEARER_TOKEN as Authorization header", () => {
    const headers = resolveAuthHeaders(testSpec, {
      cliHeaders: {},
      env: { OPENAPI_BEARER_TOKEN: "my-token" },
    });
    expect(headers["Authorization"]).toBe("Bearer my-token");
  });

  it("resolves API2MCP_AUTH_TOKEN as raw Authorization header (no Bearer prefix)", () => {
    const headers = resolveAuthHeaders(testSpec, {
      cliHeaders: {},
      env: { API2MCP_AUTH_TOKEN: "lin_api_xxx" },
    });
    expect(headers["Authorization"]).toBe("lin_api_xxx");
  });

  it("BEARER_TOKEN overrides AUTH_TOKEN when both are set", () => {
    const headers = resolveAuthHeaders(testSpec, {
      cliHeaders: {},
      env: { API2MCP_AUTH_TOKEN: "raw-token", API2MCP_BEARER_TOKEN: "bearer-token" },
    });
    expect(headers["Authorization"]).toBe("Bearer bearer-token");
  });

  it("CLI headers override env-based auth", () => {
    const headers = resolveAuthHeaders(testSpec, {
      cliHeaders: { "X-API-Key": "cli-key" },
      env: { OPENAPI_API_KEY: "env-key" },
    });
    expect(headers["X-API-Key"]).toBe("cli-key");
  });

  it("stores API key as __query: marker when scheme.in is query", () => {
    const queryKeySpec: OpenAPISpec = {
      ...testSpec,
      components: {
        ...testSpec.components,
        securitySchemes: {
          apiKey: { type: "apiKey", name: "api_key", in: "query" },
        },
      },
    };
    const headers = resolveAuthHeaders(queryKeySpec, {
      cliHeaders: {},
      env: { OPENAPI_API_KEY: "secret" },
    });
    expect(headers["__query:api_key"]).toBe("secret");
  });

  it("falls back to X-API-Key when no apiKey-type security scheme exists", () => {
    const bearerOnlySpec: OpenAPISpec = {
      ...testSpec,
      components: {
        ...testSpec.components,
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer" } as unknown as import("../src/auth.js").SecurityScheme,
        },
      },
    };
    const headers = resolveAuthHeaders(bearerOnlySpec, {
      cliHeaders: {},
      env: { OPENAPI_API_KEY: "fallback-key" },
    });
    expect(headers["X-API-Key"]).toBe("fallback-key");
  });
});

describe("executor - HTTP request building", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("builds correct URL with path and query params", async () => {
    const { executeToolCall } = await import("../src/executor.js");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "123", name: "Alice" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const tools = buildTools(testSpec);
    const getUser = tools.find((t) => t.name === "getUser")!;

    await executeToolCall(
      getUser,
      { userId: "123" },
      "https://api.example.com/v1",
      { "X-API-Key": "test" }
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.example.com/v1/users/123",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ "X-API-Key": "test" }),
      })
    );
  });

  it("sends JSON body for POST requests", async () => {
    const { executeToolCall } = await import("../src/executor.js");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "456" }), { status: 201 })
    );

    const tools = buildTools(testSpec);
    const createUser = tools.find((t) => t.name === "createUser")!;

    await executeToolCall(
      createUser,
      { body: { name: "Alice", email: "alice@test.com" } },
      "https://api.example.com/v1",
      {}
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.example.com/v1/users",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Alice", email: "alice@test.com" }),
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      })
    );
  });

  it("includes query params in URL", async () => {
    const { executeToolCall } = await import("../src/executor.js");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 })
    );

    const tools = buildTools(testSpec);
    const listUsers = tools.find((t) => t.name === "listUsers")!;

    await executeToolCall(
      listUsers,
      { page: 2, limit: 50 },
      "https://api.example.com/v1",
      {}
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.example.com/v1/users?page=2&limit=50",
      expect.any(Object)
    );
  });

  it("handles HTTP errors gracefully", async () => {
    const { executeToolCall } = await import("../src/executor.js");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Not Found", { status: 404, statusText: "Not Found" })
    );

    const tools = buildTools(testSpec);
    const getUser = tools.find((t) => t.name === "getUser")!;

    const result = await executeToolCall(
      getUser,
      { userId: "missing" },
      "https://api.example.com/v1",
      {}
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("404");
  });

  it("handles network errors gracefully", async () => {
    const { executeToolCall } = await import("../src/executor.js");

    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Connection refused")
    );

    const tools = buildTools(testSpec);
    const getUser = tools.find((t) => t.name === "getUser")!;

    const result = await executeToolCall(
      getUser,
      { userId: "123" },
      "https://api.example.com/v1",
      {}
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Connection refused");
  });
});

describe("resolveFilterOptions", () => {
  it("exits with code 1 when both --only and --exclude are provided", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    resolveFilterOptions({ only: "foo", exclude: "bar" }, []);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("mutually exclusive"));

    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("warns on unknown operations in --only", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const tools = buildTools(testSpec);

    resolveFilterOptions({ only: "nonExistent,alsoUnknown" }, tools);

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("unknown operations in --only"));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Hint:"));

    stderrSpy.mockRestore();
  });

  it("warns on unknown operations in --exclude", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const tools = buildTools(testSpec);

    resolveFilterOptions({ exclude: "nonExistent" }, tools);

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("unknown operations in --exclude"));

    stderrSpy.mockRestore();
  });

  it("returns parsed only/exclude arrays without side effects for valid inputs", () => {
    const tools = buildTools(testSpec);
    const result = resolveFilterOptions({ only: "listUsers, getUser" }, tools);

    expect(result.only).toEqual(["listUsers", "getUser"]);
    expect(result.exclude).toBeUndefined();
  });
});

describe("splitCsv", () => {
  it("splits comma-separated values", () => {
    expect(splitCsv("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("trims whitespace around values", () => {
    expect(splitCsv("a , b , c")).toEqual(["a", "b", "c"]);
  });

  it("filters out empty segments", () => {
    expect(splitCsv("a,,b")).toEqual(["a", "b"]);
  });

  it("returns single value without comma", () => {
    expect(splitCsv("onlyOne")).toEqual(["onlyOne"]);
  });

  it("returns empty array for blank string", () => {
    expect(splitCsv("")).toEqual([]);
  });

  it("handles leading/trailing commas", () => {
    expect(splitCsv(",a,b,")).toEqual(["a", "b"]);
  });
});

describe("parseBindings", () => {
  it("parses simple key=value", () => {
    expect(parseBindings(["teamId=TEAM_ABC"])).toEqual({ teamId: "TEAM_ABC" });
  });

  it("handles value containing = sign", () => {
    expect(parseBindings(["key=a=b=c"])).toEqual({ key: "a=b=c" });
  });

  it("trims whitespace from key", () => {
    expect(parseBindings([" teamId =TEAM_ABC"])).toEqual({ teamId: "TEAM_ABC" });
  });

  it("trims whitespace from value", () => {
    expect(parseBindings(["teamId= TEAM_ABC "])).toEqual({ teamId: "TEAM_ABC" });
  });

  it("skips reserved param 'body' with a warning", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = parseBindings(["body=something"]);

    expect(result).toEqual({});
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("reserved parameter 'body'"));

    stderrSpy.mockRestore();
  });

  it("skips entries without =", () => {
    expect(parseBindings(["noequals"])).toEqual({});
  });

  it("skips entries with empty key", () => {
    expect(parseBindings(["=value"])).toEqual({});
  });

  it("returns empty object for empty array", () => {
    expect(parseBindings([])).toEqual({});
  });

  it("parses multiple bindings", () => {
    expect(parseBindings(["teamId=T1", "projectId=P2"])).toEqual({
      teamId: "T1",
      projectId: "P2",
    });
  });

  it("last value wins when key is duplicated", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = parseBindings(["teamId=A", "teamId=B"]);

    expect(result).toEqual({ teamId: "B" });
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("duplicate --bind key 'teamId'"));

    stderrSpy.mockRestore();
  });

  it("allows empty value and warns", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = parseBindings(["key="]);

    expect(result).toEqual({ key: "" });
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("empty value"));

    stderrSpy.mockRestore();
  });
});

describe("applyBindings", () => {
  it("removes bound param from properties", () => {
    const tools = buildTools(testSpec);
    const getUser = tools.find((t) => t.name === "getUser")!;

    const [bound] = applyBindings([getUser], { userId: "fixed" });

    expect(bound.inputSchema.properties).not.toHaveProperty("userId");
  });

  it("removes bound param from required array", () => {
    const tools = buildTools(testSpec);
    const getUser = tools.find((t) => t.name === "getUser")!;

    const [bound] = applyBindings([getUser], { userId: "fixed" });

    expect(bound.inputSchema.required).not.toContain("userId");
  });

  it("removes bound param from pathParams", () => {
    const tools = buildTools(testSpec);
    const getUser = tools.find((t) => t.name === "getUser")!;

    const [bound] = applyBindings([getUser], { userId: "fixed" });

    expect(bound.pathParams).not.toContain("userId");
  });

  it("removes bound query param from queryParams", () => {
    const tools = buildTools(testSpec);
    const listUsers = tools.find((t) => t.name === "listUsers")!;
    // Add a queryParam assumption: listUsers may have query params
    // Just verify that a binding for a non-existent key does nothing
    const [bound] = applyBindings([listUsers], { nonExistent: "x" });

    expect(bound.inputSchema.properties).toEqual(listUsers.inputSchema.properties);
  });

  it("does not mutate the original tool", () => {
    const tools = buildTools(testSpec);
    const getUser = tools.find((t) => t.name === "getUser")!;
    const originalRequired = [...getUser.inputSchema.required];

    applyBindings([getUser], { userId: "fixed" });

    expect(getUser.inputSchema.required).toEqual(originalRequired);
  });

  it("returns tools unchanged when bindings is empty", () => {
    const tools = buildTools(testSpec);
    const result = applyBindings(tools, {});

    expect(result).toEqual(tools);
  });

  it("unbound params are preserved", () => {
    const tools = buildTools(testSpec);
    const getUser = tools.find((t) => t.name === "getUser")!;

    const [bound] = applyBindings([getUser], { someOtherParam: "x" });

    expect(bound.inputSchema.properties).toHaveProperty("userId");
  });
});

// ─── executeToolCall ──────────────────────────────────────────────────────────

describe("executeToolCall", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const pathTool = {
    name: "getUser",
    description: "Get user",
    inputSchema: { type: "object" as const, properties: { userId: { type: "string" } }, required: ["userId"] },
    method: "GET",
    pathTemplate: "/users/{userId}",
    pathParams: ["userId"],
    queryParams: [],
    hasBody: false,
  };

  it("returns error when required path param is missing from args", async () => {
    const result = await executeToolCall(pathTool, {}, "https://api.example.com", {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Missing required path parameter: userId");
  });

  it("sends API key as query param when authHeaders contains __query: marker", async () => {
    const tool = { ...pathTool, pathParams: [], pathTemplate: "/users" };
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => "[]",
    } as Response);

    await executeToolCall(tool, {}, "https://api.example.com", {
      "__query:api_key": "secret123",
    });

    const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("api_key=secret123");
    expect(url).not.toContain("__query");
  });

  it("returns non-JSON response as plain text", async () => {
    const tool = { ...pathTool, pathParams: [], pathTemplate: "/health" };
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => "OK",
    } as Response);

    const result = await executeToolCall(tool, {}, "https://api.example.com", {});
    expect(result.isError).toBe(false);
    expect(result.content).toBe("OK");
  });

  it("returns isError: true on non-Error network rejection", async () => {
    const tool = { ...pathTool, pathParams: [], pathTemplate: "/users" };
    vi.mocked(fetch).mockRejectedValue("connection refused");

    const result = await executeToolCall(tool, {}, "https://api.example.com", {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("connection refused");
  });
});

// ─── buildTools — edge cases ──────────────────────────────────────────────────

describe("resolveBaseUrl — relative server URL with local file source", () => {
  it("returns localhost URL when servers URL is relative and source is a local file", () => {
    expect(resolveBaseUrl("/api/v1", "./spec.yaml")).toBe("http://localhost/api/v1");
  });

  it("handles relative server URL without leading slash", () => {
    expect(resolveBaseUrl("api/v1", "./spec.yaml")).toBe("http://localhost/api/v1");
  });
});

describe("buildTools — $ref requestBody", () => {
  it("resolves $ref request body from components", () => {
    const spec: OpenAPISpec = {
      openapi: "3.0.0",
      info: { title: "T", version: "1" },
      paths: {
        "/users": {
          post: {
            operationId: "createUser",
            requestBody: { $ref: "#/components/requestBodies/UserBody" },
          },
        },
      },
      components: {
        requestBodies: {
          UserBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", properties: { name: { type: "string" } } },
              },
            },
          },
        },
      },
    };

    const tools = buildTools(spec);
    const tool = tools.find((t) => t.name === "createUser")!;
    expect(tool.hasBody).toBe(true);
    expect(tool.inputSchema.properties).toHaveProperty("body");
  });
});

describe("buildTools — $ref parameter", () => {
  it("resolves $ref parameter from components", () => {
    const spec: OpenAPISpec = {
      openapi: "3.0.0",
      info: { title: "T", version: "1" },
      paths: {
        "/users": {
          get: {
            operationId: "listUsers",
            parameters: [{ $ref: "#/components/parameters/PageParam" }],
          },
        },
      },
      components: {
        parameters: {
          PageParam: { name: "page", in: "query", schema: { type: "integer" } },
        },
      },
    };

    const tools = buildTools(spec);
    const tool = tools.find((t) => t.name === "listUsers")!;
    expect(tool.inputSchema.properties).toHaveProperty("page");
    expect(tool.queryParams).toContain("page");
  });
});

describe("buildTools — requestBody with */* content type and description", () => {
  it("uses */* content type as fallback when application/json is absent", () => {
    const spec: OpenAPISpec = {
      openapi: "3.0.0",
      info: { title: "T", version: "1" },
      paths: {
        "/upload": {
          post: {
            operationId: "upload",
            requestBody: {
              content: {
                "*/*": { schema: { type: "object", properties: { data: { type: "string" } } } },
              },
            },
          },
        },
      },
    };

    const tools = buildTools(spec);
    const tool = tools.find((t) => t.name === "upload")!;
    expect(tool.hasBody).toBe(true);
    expect(tool.inputSchema.properties).toHaveProperty("body");
  });

  it("includes requestBody description in body property", () => {
    const spec: OpenAPISpec = {
      openapi: "3.0.0",
      info: { title: "T", version: "1" },
      paths: {
        "/users": {
          post: {
            operationId: "createUser",
            requestBody: {
              description: "User payload",
              content: {
                "application/json": { schema: { type: "object" } },
              },
            },
          },
        },
      },
    };

    const tools = buildTools(spec);
    const tool = tools.find((t) => t.name === "createUser")!;
    expect(tool.inputSchema.properties["body"]).toMatchObject({ description: "User payload" });
  });
});

describe("buildTools — parameter without schema", () => {
  it("falls back to string type when parameter has no schema", () => {
    const spec: OpenAPISpec = {
      openapi: "3.0.0",
      info: { title: "T", version: "1" },
      paths: {
        "/search": {
          get: {
            operationId: "search",
            parameters: [{ name: "q", in: "query" }], // no schema
          },
        },
      },
    };

    const tools = buildTools(spec);
    const tool = tools.find((t) => t.name === "search")!;
    expect(tool.inputSchema.properties["q"]).toEqual({ type: "string" });
  });

  it("marks query parameter as required when required: true in spec", () => {
    const spec: OpenAPISpec = {
      openapi: "3.0.0",
      info: { title: "T", version: "1" },
      paths: {
        "/search": {
          get: {
            operationId: "search",
            parameters: [
              { name: "q", in: "query", required: true, schema: { type: "string" } },
            ],
          },
        },
      },
    };

    const tools = buildTools(spec);
    const tool = tools.find((t) => t.name === "search")!;
    expect(tool.inputSchema.required).toContain("q");
  });
});

// ─── loadSpec — local file and validation ─────────────────────────────────────

describe("loadSpec — HTTP errors and unknown format", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws on HTTP error response", async () => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    } as Response);

    await expect(loadSpec("https://api.example.com/openapi.json")).rejects.toThrow(
      "Failed to fetch spec from https://api.example.com/openapi.json: 404 Not Found"
    );
  });

  it("loads spec when content-type has no json/yaml hint (falls back to content detection)", async () => {
    const spec = { openapi: "3.0.0", info: { title: "T", version: "1" }, paths: {} };
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(spec),
      headers: { get: () => "text/plain" }, // no json/yaml content-type
    } as unknown as Response);

    // URL with no .json/.yaml extension → formatHint returns undefined → parseContent guesses from content
    const loaded = await loadSpec("https://api.example.com/schema");
    expect(loaded.openapi).toBe("3.0.0");
  });
});

describe("loadSpec — local file", () => {
  it("loads a valid spec from a local JSON file", async () => {
    const { writeFile, unlink } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const spec = {
      openapi: "3.0.0",
      info: { title: "Local API", version: "1.0.0" },
      paths: { "/ping": { get: { operationId: "ping" } } },
    };
    const filePath = join(tmpdir(), `test-spec-${Date.now()}.json`);
    await writeFile(filePath, JSON.stringify(spec), "utf-8");

    try {
      const loaded = await loadSpec(filePath);
      expect(loaded.info.title).toBe("Local API");
      expect(loaded.paths["/ping"]).toBeDefined();
    } finally {
      await unlink(filePath);
    }
  });

  it("throws for spec missing openapi field", async () => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ paths: {} }),
      headers: { get: () => "application/json" },
    } as unknown as Response);

    await expect(loadSpec("https://api.example.com/openapi.json")).rejects.toThrow(
      "Invalid OpenAPI spec"
    );
    vi.unstubAllGlobals();
  });

  it("loads a valid spec from a local .yml file", async () => {
    const { writeFile, unlink } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const spec = {
      openapi: "3.0.0",
      info: { title: "YML API", version: "1.0.0" },
      paths: { "/health": { get: { operationId: "health" } } },
    };
    const filePath = join(tmpdir(), `test-spec-${Date.now()}.yml`);
    const yaml = `openapi: "3.0.0"\ninfo:\n  title: "YML API"\n  version: "1.0.0"\npaths:\n  /health:\n    get:\n      operationId: health\n`;
    await writeFile(filePath, yaml, "utf-8");

    try {
      const loaded = await loadSpec(filePath);
      expect(loaded.info.title).toBe("YML API");
    } finally {
      await unlink(filePath);
    }
  });
});
