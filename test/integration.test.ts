import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadSpec, resolveRef, resolveSchemaRefs } from "../src/spec-loader.js";
import { buildTools, filterTools } from "../src/tool-builder.js";
import { resolveBaseUrl } from "../src/executor.js";
import { resolveAuthHeaders, parseHeaderFlags } from "../src/auth.js";
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

    expect(tools.length).toBe(6);

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

describe("filterTools --readonly", () => {
  it("returns only GET tools when readonly is true", () => {
    const tools = buildTools(testSpec);
    const readonly = filterTools(tools, { readonly: true });

    expect(readonly.every((t) => t.method === "GET")).toBe(true);
    expect(readonly.map((t) => t.name)).toEqual(
      expect.arrayContaining(["listUsers", "getUser", "get_health"])
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

  it("CLI headers override env-based auth", () => {
    const headers = resolveAuthHeaders(testSpec, {
      cliHeaders: { "X-API-Key": "cli-key" },
      env: { OPENAPI_API_KEY: "env-key" },
    });
    expect(headers["X-API-Key"]).toBe("cli-key");
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
