import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildGraphQLTools,
  graphqlTypeToJsonSchema,
  buildSelectionSet,
} from "../src/graphql-tool-builder.js";
import {
  buildGraphQLQuery,
  executeGraphQLCall,
} from "../src/graphql-executor.js";
import {
  loadGraphQLSchema,
  INTROSPECTION_QUERY,
} from "../src/graphql-loader.js";
import type {
  IntrospectionSchema,
  IntrospectionTypeRef,
  IntrospectionType,
} from "../src/graphql-loader.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function nonNull(inner: IntrospectionTypeRef): IntrospectionTypeRef {
  return { kind: "NON_NULL", name: null, ofType: inner };
}
function listOf(inner: IntrospectionTypeRef): IntrospectionTypeRef {
  return { kind: "LIST", name: null, ofType: inner };
}
function scalar(name: string): IntrospectionTypeRef {
  return { kind: "SCALAR", name, ofType: null };
}
function objectRef(name: string): IntrospectionTypeRef {
  return { kind: "OBJECT", name, ofType: null };
}
function enumRef(name: string): IntrospectionTypeRef {
  return { kind: "ENUM", name, ofType: null };
}
function inputRef(name: string): IntrospectionTypeRef {
  return { kind: "INPUT_OBJECT", name, ofType: null };
}

const BUILTIN_SCALAR_TYPES: IntrospectionType[] = [
  { kind: "SCALAR", name: "String" },
  { kind: "SCALAR", name: "ID" },
  { kind: "SCALAR", name: "Int" },
  { kind: "SCALAR", name: "Float" },
  { kind: "SCALAR", name: "Boolean" },
];

/** Minimal schema with Query + Mutation + User type */
const simpleSchema: IntrospectionSchema = {
  queryType: { name: "Query" },
  mutationType: { name: "Mutation" },
  subscriptionType: null,
  types: [
    ...BUILTIN_SCALAR_TYPES,
    {
      kind: "OBJECT",
      name: "Query",
      fields: [
        {
          name: "getUser",
          description: "Get a user by ID",
          args: [
            {
              name: "id",
              type: nonNull(scalar("ID")),
              defaultValue: null,
            },
          ],
          type: objectRef("User"),
        },
        {
          name: "listUsers",
          description: null,
          args: [
            {
              name: "limit",
              type: scalar("Int"), // optional
              defaultValue: null,
            },
          ],
          type: listOf(objectRef("User")),
        },
      ],
    },
    {
      kind: "OBJECT",
      name: "Mutation",
      fields: [
        {
          name: "createUser",
          description: "Create a new user",
          args: [
            {
              name: "input",
              type: nonNull(inputRef("CreateUserInput")),
              defaultValue: null,
            },
          ],
          type: objectRef("User"),
        },
      ],
    },
    {
      kind: "OBJECT",
      name: "User",
      fields: [
        { name: "id", description: null, args: [], type: nonNull(scalar("ID")) },
        { name: "name", description: null, args: [], type: scalar("String") },
        { name: "email", description: null, args: [], type: scalar("String") },
        { name: "role", description: null, args: [], type: enumRef("Role") },
      ],
    },
    {
      kind: "INPUT_OBJECT",
      name: "CreateUserInput",
      inputFields: [
        { name: "name", type: nonNull(scalar("String")), defaultValue: null },
        { name: "email", type: scalar("String"), defaultValue: null },
      ],
    },
    {
      kind: "ENUM",
      name: "Role",
      enumValues: [{ name: "ADMIN" }, { name: "USER" }, { name: "GUEST" }],
    },
  ],
};

// ─── graphqlTypeToJsonSchema ──────────────────────────────────────────────────

describe("graphqlTypeToJsonSchema", () => {
  const typeMap = new Map(
    simpleSchema.types
      .filter((t) => t.name !== null)
      .map((t) => [t.name!, t])
  );

  it("maps String → string", () => {
    expect(graphqlTypeToJsonSchema(scalar("String"), typeMap)).toEqual({ type: "string" });
  });

  it("maps ID → string", () => {
    expect(graphqlTypeToJsonSchema(scalar("ID"), typeMap)).toEqual({ type: "string" });
  });

  it("maps Int → integer", () => {
    expect(graphqlTypeToJsonSchema(scalar("Int"), typeMap)).toEqual({ type: "integer" });
  });

  it("maps Float → number", () => {
    expect(graphqlTypeToJsonSchema(scalar("Float"), typeMap)).toEqual({ type: "number" });
  });

  it("maps Boolean → boolean", () => {
    expect(graphqlTypeToJsonSchema(scalar("Boolean"), typeMap)).toEqual({ type: "boolean" });
  });

  it("unwraps NON_NULL before mapping", () => {
    expect(graphqlTypeToJsonSchema(nonNull(scalar("String")), typeMap)).toEqual({ type: "string" });
  });

  it("maps LIST → array with items", () => {
    expect(graphqlTypeToJsonSchema(listOf(scalar("String")), typeMap)).toEqual({
      type: "array",
      items: { type: "string" },
    });
  });

  it("maps ENUM → string with enum values", () => {
    expect(graphqlTypeToJsonSchema(enumRef("Role"), typeMap)).toEqual({
      type: "string",
      enum: ["ADMIN", "USER", "GUEST"],
    });
  });

  it("maps INPUT_OBJECT → object with properties and required", () => {
    const result = graphqlTypeToJsonSchema(inputRef("CreateUserInput"), typeMap);
    expect(result).toEqual({
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
      },
      required: ["name"],
    });
  });

  it("maps nested LIST of objects", () => {
    const result = graphqlTypeToJsonSchema(listOf(nonNull(scalar("Int"))), typeMap);
    expect(result).toEqual({ type: "array", items: { type: "integer" } });
  });
});

// ─── buildSelectionSet ────────────────────────────────────────────────────────

describe("buildSelectionSet", () => {
  const typeMap = new Map(
    simpleSchema.types
      .filter((t) => t.name !== null)
      .map((t) => [t.name!, t])
  );

  it("returns empty string for scalar return type", () => {
    expect(buildSelectionSet(scalar("String"), typeMap)).toBe("");
  });

  it("returns empty string for enum return type", () => {
    expect(buildSelectionSet(enumRef("Role"), typeMap)).toBe("");
  });

  it("selects scalar fields for object return type", () => {
    const result = buildSelectionSet(objectRef("User"), typeMap);
    expect(result).toContain("id");
    expect(result).toContain("name");
    expect(result).toContain("email");
    // role is an enum — also a leaf type
    expect(result).toContain("role");
    expect(result).toMatch(/^\{.*\}$/s);
  });

  it("unwraps NON_NULL before selecting", () => {
    const result = buildSelectionSet(nonNull(objectRef("User")), typeMap);
    expect(result).toContain("id");
  });

  it("unwraps LIST before selecting", () => {
    const result = buildSelectionSet(listOf(objectRef("User")), typeMap);
    expect(result).toContain("id");
  });
});

describe("buildSelectionSet with nested objects", () => {
  // Schema: Post → author: User → (scalars)
  const nestedTypes: IntrospectionType[] = [
    ...BUILTIN_SCALAR_TYPES,
    {
      kind: "OBJECT",
      name: "Post",
      fields: [
        { name: "id", description: null, args: [], type: nonNull(scalar("ID")) },
        { name: "title", description: null, args: [], type: scalar("String") },
        { name: "author", description: null, args: [], type: objectRef("User") },
      ],
    },
    {
      kind: "OBJECT",
      name: "User",
      fields: [
        { name: "id", description: null, args: [], type: nonNull(scalar("ID")) },
        { name: "name", description: null, args: [], type: scalar("String") },
      ],
    },
  ];
  const typeMap = new Map(nestedTypes.filter((t) => t.name).map((t) => [t.name!, t]));

  it("includes nested object fields at depth 1 with sub-selection", () => {
    const result = buildSelectionSet(objectRef("Post"), typeMap);
    expect(result).toContain("id");
    expect(result).toContain("title");
    expect(result).toContain("author");
    expect(result).toContain("author { id name }");
  });

  it("does not recurse deeper than depth 1", () => {
    // DeepPost → post: Post → author: User → (beyond limit)
    const deepTypes: IntrospectionType[] = [
      ...nestedTypes,
      {
        kind: "OBJECT",
        name: "DeepPost",
        fields: [
          { name: "post", description: null, args: [], type: objectRef("Post") },
        ],
      },
    ];
    const deepMap = new Map(deepTypes.filter((t) => t.name).map((t) => [t.name!, t]));
    const result = buildSelectionSet(objectRef("DeepPost"), deepMap);
    // post should be included with its scalar sub-fields
    expect(result).toContain("post");
    // author is at depth 2 — should NOT have a sub-selection (but may appear as scalar field)
    // The key is it doesn't recurse into author's fields
    expect(result).not.toMatch(/author \{[^}]+\{/); // no doubly-nested braces
  });
});

// ─── buildGraphQLTools ────────────────────────────────────────────────────────

describe("buildGraphQLTools", () => {
  it("creates query_ tools from Query type fields", () => {
    const tools = buildGraphQLTools(simpleSchema);
    const names = tools.map((t) => t.name);
    expect(names).toContain("query_getUser");
    expect(names).toContain("query_listUsers");
  });

  it("creates mutation_ tools from Mutation type fields", () => {
    const tools = buildGraphQLTools(simpleSchema);
    const names = tools.map((t) => t.name);
    expect(names).toContain("mutation_createUser");
  });

  it("omits mutation tools when readonly: true", () => {
    const tools = buildGraphQLTools(simpleSchema, { readonly: true });
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("mutation_createUser");
    expect(names).toContain("query_getUser");
  });

  it("sets description from field description", () => {
    const tools = buildGraphQLTools(simpleSchema);
    const tool = tools.find((t) => t.name === "query_getUser")!;
    expect(tool.description).toBe("Get a user by ID");
  });

  it("uses fallback description when field has no description", () => {
    const tools = buildGraphQLTools(simpleSchema);
    const tool = tools.find((t) => t.name === "query_listUsers")!;
    expect(tool.description).toBe("No description available");
  });

  it("marks NON_NULL args as required", () => {
    const tools = buildGraphQLTools(simpleSchema);
    const tool = tools.find((t) => t.name === "query_getUser")!;
    expect(tool.inputSchema.required).toContain("id");
  });

  it("does not mark nullable args as required", () => {
    const tools = buildGraphQLTools(simpleSchema);
    const tool = tools.find((t) => t.name === "query_listUsers")!;
    expect(tool.inputSchema.required).not.toContain("limit");
  });

  it("builds correct JSON Schema for scalar args", () => {
    const tools = buildGraphQLTools(simpleSchema);
    const tool = tools.find((t) => t.name === "query_getUser")!;
    expect(tool.inputSchema.properties["id"]).toEqual({ type: "string" });
  });

  it("builds correct JSON Schema for InputObject args", () => {
    const tools = buildGraphQLTools(simpleSchema);
    const tool = tools.find((t) => t.name === "mutation_createUser")!;
    expect(tool.inputSchema.properties["input"]).toMatchObject({
      type: "object",
      properties: { name: { type: "string" }, email: { type: "string" } },
      required: ["name"],
    });
  });

  it("sets operationType correctly", () => {
    const tools = buildGraphQLTools(simpleSchema);
    const query = tools.find((t) => t.name === "query_getUser")!;
    const mutation = tools.find((t) => t.name === "mutation_createUser")!;
    expect(query.operationType).toBe("query");
    expect(mutation.operationType).toBe("mutation");
  });

  it("sets fieldName to the original field name", () => {
    const tools = buildGraphQLTools(simpleSchema);
    const tool = tools.find((t) => t.name === "query_getUser")!;
    expect(tool.fieldName).toBe("getUser");
  });

  it("sets variableDefinitions with correct gqlType strings", () => {
    const tools = buildGraphQLTools(simpleSchema);
    const tool = tools.find((t) => t.name === "query_getUser")!;
    expect(tool.variableDefinitions).toEqual([{ name: "id", gqlType: "ID!" }]);
  });

  it("sets variableDefinitions with LIST gqlType for list args", () => {
    const listArgSchema: IntrospectionSchema = {
      queryType: { name: "Query" },
      mutationType: null,
      subscriptionType: null,
      types: [
        ...BUILTIN_SCALAR_TYPES,
        {
          kind: "OBJECT",
          name: "Query",
          fields: [
            {
              name: "getUsers",
              description: null,
              args: [
                {
                  name: "ids",
                  type: nonNull(listOf(nonNull(scalar("ID")))),
                  defaultValue: null,
                },
              ],
              type: listOf(objectRef("User")),
            },
          ],
        },
        {
          kind: "OBJECT",
          name: "User",
          fields: [{ name: "id", description: null, args: [], type: nonNull(scalar("ID")) }],
        },
      ],
    };
    const tools = buildGraphQLTools(listArgSchema);
    const tool = tools.find((t) => t.name === "query_getUsers")!;
    expect(tool.variableDefinitions).toEqual([{ name: "ids", gqlType: "[ID!]!" }]);
  });

  it("includes selectionSet for object return type", () => {
    const tools = buildGraphQLTools(simpleSchema);
    const tool = tools.find((t) => t.name === "query_getUser")!;
    expect(tool.selectionSet).toContain("id");
    expect(tool.selectionSet).toContain("name");
  });

  it("returns empty tools when schema has no queryType", () => {
    const noQuery: IntrospectionSchema = { ...simpleSchema, queryType: null, mutationType: null };
    expect(buildGraphQLTools(noQuery)).toEqual([]);
  });

  it("skips introspection types (__ prefixed)", () => {
    const tools = buildGraphQLTools(simpleSchema);
    expect(tools.every((t) => !t.name.includes("__"))).toBe(true);
  });
});

// ─── buildGraphQLQuery ────────────────────────────────────────────────────────

describe("buildGraphQLQuery", () => {
  const tools = buildGraphQLTools(simpleSchema);

  it("builds a query string with variables for query_getUser", () => {
    const tool = tools.find((t) => t.name === "query_getUser")!;
    const query = buildGraphQLQuery(tool);
    expect(query).toContain("query query_getUser($id: ID!)");
    expect(query).toContain("getUser(id: $id)");
    expect(query).toContain("{ id");
  });

  it("builds a mutation string for mutation_createUser", () => {
    const tool = tools.find((t) => t.name === "mutation_createUser")!;
    const query = buildGraphQLQuery(tool);
    expect(query).toContain("mutation mutation_createUser");
    expect(query).toContain("createUser(input: $input)");
  });

  it("builds a query without variable definitions when no args", () => {
    // Create a no-arg tool
    const noArgSchema: IntrospectionSchema = {
      ...simpleSchema,
      types: [
        ...BUILTIN_SCALAR_TYPES,
        {
          kind: "OBJECT",
          name: "Query",
          fields: [
            {
              name: "ping",
              description: null,
              args: [],
              type: scalar("String"),
            },
          ],
        },
      ],
    };
    const noArgTools = buildGraphQLTools(noArgSchema);
    const tool = noArgTools.find((t) => t.name === "query_ping")!;
    const query = buildGraphQLQuery(tool);
    expect(query).toContain("query query_ping {");
    expect(query).not.toContain("(");
  });
});

// ─── executeGraphQLCall ───────────────────────────────────────────────────────

describe("executeGraphQLCall", () => {
  const tools = buildGraphQLTools(simpleSchema);

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the correct query and variables to the endpoint", async () => {
    const tool = tools.find((t) => t.name === "query_getUser")!;
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ data: { getUser: { id: "1", name: "Alice" } } }),
    } as Response);

    await executeGraphQLCall(tool, { id: "1" }, "https://api.example.com/graphql", {});

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/graphql");
    const body = JSON.parse(init.body as string);
    expect(body.query).toContain("query query_getUser");
    expect(body.variables).toEqual({ id: "1" });
  });

  it("returns formatted JSON on success", async () => {
    const tool = tools.find((t) => t.name === "query_getUser")!;
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ data: { getUser: { id: "1", name: "Alice", email: null } } }),
    } as Response);

    const result = await executeGraphQLCall(tool, { id: "1" }, "https://api.example.com/graphql", {});
    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.content);
    expect(parsed).toEqual({ id: "1", name: "Alice", email: null });
  });

  it("returns isError: true on HTTP error", async () => {
    const tool = tools.find((t) => t.name === "query_getUser")!;
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "Unauthorized",
    } as Response);

    const result = await executeGraphQLCall(tool, { id: "1" }, "https://api.example.com/graphql", {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("401");
  });

  it("returns isError: true when response contains GraphQL errors", async () => {
    const tool = tools.find((t) => t.name === "query_getUser")!;
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ errors: [{ message: "User not found" }] }),
    } as Response);

    const result = await executeGraphQLCall(tool, { id: "999" }, "https://api.example.com/graphql", {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("User not found");
  });

  it("returns isError: true on network error", async () => {
    const tool = tools.find((t) => t.name === "query_getUser")!;
    vi.mocked(fetch).mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await executeGraphQLCall(tool, { id: "1" }, "https://api.example.com/graphql", {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("ECONNREFUSED");
  });

  it("sends auth headers to endpoint", async () => {
    const tool = tools.find((t) => t.name === "query_getUser")!;
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ data: { getUser: null } }),
    } as Response);

    await executeGraphQLCall(tool, { id: "1" }, "https://api.example.com/graphql", {
      Authorization: "Bearer token123",
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer token123");
  });

  it("only passes declared variables, not extra args", async () => {
    const tool = tools.find((t) => t.name === "query_getUser")!;
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ data: { getUser: null } }),
    } as Response);

    await executeGraphQLCall(tool, { id: "1", extraField: "ignored" }, "https://api.example.com/graphql", {});

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.variables).toEqual({ id: "1" });
    expect(body.variables).not.toHaveProperty("extraField");
  });

  it("falls back to full response JSON when data has no field key", async () => {
    const tool = tools.find((t) => t.name === "query_getUser")!;
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ status: "ok" }), // no "data" key
    } as Response);

    const result = await executeGraphQLCall(tool, { id: "1" }, "https://api.example.com/graphql", {});
    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.content);
    expect(parsed).toEqual({ status: "ok" });
  });

  it("returns isError: true on non-Error network rejection", async () => {
    const tool = tools.find((t) => t.name === "query_getUser")!;
    vi.mocked(fetch).mockRejectedValue("string error");

    const result = await executeGraphQLCall(tool, { id: "1" }, "https://api.example.com/graphql", {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("string error");
  });

  it("returns raw text when response body is not JSON", async () => {
    const tool = tools.find((t) => t.name === "query_getUser")!;
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => "not json at all",
    } as Response);

    const result = await executeGraphQLCall(tool, { id: "1" }, "https://api.example.com/graphql", {});
    expect(result.isError).toBe(false);
    expect(result.content).toBe("not json at all");
  });
});

// ─── buildSelectionSet — UNION and edge cases ─────────────────────────────────

describe("buildSelectionSet — UNION type", () => {
  const unionTypes: IntrospectionType[] = [
    ...BUILTIN_SCALAR_TYPES,
    {
      kind: "UNION",
      name: "SearchResult",
      possibleTypes: [{ name: "User", kind: "OBJECT" }, { name: "Post", kind: "OBJECT" }],
    },
    {
      kind: "OBJECT",
      name: "User",
      fields: [
        { name: "id", description: null, args: [], type: nonNull(scalar("ID")) },
        { name: "name", description: null, args: [], type: scalar("String") },
      ],
    },
    {
      kind: "OBJECT",
      name: "Post",
      fields: [
        { name: "id", description: null, args: [], type: nonNull(scalar("ID")) },
        { name: "title", description: null, args: [], type: scalar("String") },
      ],
    },
  ];
  const typeMap = new Map(unionTypes.filter((t) => t.name).map((t) => [t.name!, t]));

  it("includes __typename for union types", () => {
    const result = buildSelectionSet({ kind: "UNION", name: "SearchResult", ofType: null }, typeMap);
    expect(result).toContain("__typename");
  });

  it("includes inline fragments for each possible type", () => {
    const result = buildSelectionSet({ kind: "UNION", name: "SearchResult", ofType: null }, typeMap);
    expect(result).toContain("... on User");
    expect(result).toContain("... on Post");
  });

  it("returns empty string for unknown union (no possibleTypes)", () => {
    const noTypes: IntrospectionType[] = [
      { kind: "UNION", name: "Empty", possibleTypes: [] },
    ];
    const map = new Map(noTypes.map((t) => [t.name!, t]));
    // UNION with empty possibleTypes — no fragments added, result is "{ __typename }"
    const result = buildSelectionSet({ kind: "UNION", name: "Empty", ofType: null }, map);
    expect(result).toBe("{ __typename }");
  });
});

describe("buildSelectionSet — object with no selectable fields", () => {
  it("falls back to field name when nested object has no scalar fields", () => {
    // EmptyNested has only a nested object field with no scalars
    const types: IntrospectionType[] = [
      ...BUILTIN_SCALAR_TYPES,
      {
        kind: "OBJECT",
        name: "Wrapper",
        fields: [
          { name: "inner", description: null, args: [], type: objectRef("EmptyObj") },
        ],
      },
      {
        kind: "OBJECT",
        name: "EmptyObj",
        // Has only an object field at depth 2, no scalars at depth 1
        fields: [
          { name: "deep", description: null, args: [], type: objectRef("DeepObj") },
        ],
      },
      {
        kind: "OBJECT",
        name: "DeepObj",
        fields: [
          { name: "value", description: null, args: [], type: scalar("String") },
        ],
      },
    ];
    const typeMap = new Map(types.filter((t) => t.name).map((t) => [t.name!, t]));
    const result = buildSelectionSet(objectRef("Wrapper"), typeMap);
    // inner should be included since EmptyObj at depth 1 recurse into depth 2
    // but EmptyObj itself has no scalars at depth 1, so sub is empty at depth 1
    // → falls back to just "inner"
    expect(result).toContain("inner");
  });
});

// ─── graphqlTypeToJsonSchema — edge cases ─────────────────────────────────────

describe("graphqlTypeToJsonSchema — edge cases", () => {
  const typeMap = new Map(
    simpleSchema.types.filter((t) => t.name).map((t) => [t.name!, t])
  );

  it("falls back to string for unknown type", () => {
    expect(graphqlTypeToJsonSchema(
      { kind: "OBJECT", name: "NonExistentType", ofType: null },
      typeMap
    )).toEqual({ type: "string" });
  });

  it("returns string for custom SCALAR type", () => {
    const customScalarTypes: IntrospectionType[] = [
      { kind: "SCALAR", name: "DateTime" },
    ];
    const map = new Map(customScalarTypes.map((t) => [t.name!, t]));
    expect(graphqlTypeToJsonSchema(
      { kind: "SCALAR", name: "DateTime", ofType: null },
      map
    )).toEqual({ type: "string" });
  });

  it("handles circular INPUT_OBJECT references", () => {
    const circularTypes: IntrospectionType[] = [
      {
        kind: "INPUT_OBJECT",
        name: "RecursiveInput",
        inputFields: [
          { name: "child", type: inputRef("RecursiveInput"), defaultValue: null },
          { name: "value", type: scalar("String"), defaultValue: null },
        ],
      },
    ];
    const map = new Map(circularTypes.map((t) => [t.name!, t]));
    // Should not throw or recurse infinitely
    const result = graphqlTypeToJsonSchema(inputRef("RecursiveInput"), map);
    expect(result).toMatchObject({ type: "object" });
  });

  it("includes description for INPUT_OBJECT fields that have one", () => {
    const withDesc: IntrospectionType[] = [
      {
        kind: "INPUT_OBJECT",
        name: "DescInput",
        inputFields: [
          { name: "field", description: "A described field", type: scalar("String"), defaultValue: null },
        ],
      },
    ];
    const map = new Map([...withDesc, ...simpleSchema.types.filter(t => t.name)].map((t) => [t.name!, t]));
    const result = graphqlTypeToJsonSchema(inputRef("DescInput"), map) as Record<string, unknown>;
    expect((result.properties as Record<string, unknown>)["field"]).toMatchObject({
      type: "string",
      description: "A described field",
    });
  });
});

// ─── loadGraphQLSchema ────────────────────────────────────────────────────────

describe("loadGraphQLSchema — introspection via HTTP", () => {
  const mockSchema: IntrospectionSchema = {
    queryType: { name: "Query" },
    mutationType: null,
    subscriptionType: null,
    types: [{ kind: "OBJECT", name: "Query", fields: [] }],
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends POST with introspection query", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { __schema: mockSchema } }),
    } as Response);

    await loadGraphQLSchema("https://api.example.com/graphql", { Authorization: "Bearer token" });

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/graphql");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer token");
    const body = JSON.parse(init.body as string);
    expect(body.query).toContain("IntrospectionQuery");
  });

  it("returns the introspection schema", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { __schema: mockSchema } }),
    } as Response);

    const result = await loadGraphQLSchema("https://api.example.com/graphql");
    expect(result).toEqual(mockSchema);
  });

  it("throws on HTTP error", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    } as Response);

    await expect(loadGraphQLSchema("https://api.example.com/graphql")).rejects.toThrow(
      "introspection failed: 401 Unauthorized"
    );
  });

  it("throws when response contains GraphQL errors", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ errors: [{ message: "Not allowed" }] }),
    } as Response);

    await expect(loadGraphQLSchema("https://api.example.com/graphql")).rejects.toThrow(
      "introspection errors"
    );
  });

  it("throws when __schema is missing from response", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: {} }),
    } as Response);

    await expect(loadGraphQLSchema("https://api.example.com/graphql")).rejects.toThrow(
      "missing __schema"
    );
  });
});

describe("loadGraphQLSchema — SDL file", () => {
  it("loads schema from a real SDL string written to a temp file", async () => {
    const { writeFile, unlink } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const sdlPath = join(tmpdir(), `test-schema-${Date.now()}.graphql`);
    const sdl = `
      type Query {
        ping: String
      }
    `;
    await writeFile(sdlPath, sdl, "utf-8");

    try {
      const schema = await loadGraphQLSchema(sdlPath);
      expect(schema.queryType?.name).toBe("Query");
      const queryType = schema.types.find((t) => t.name === "Query");
      expect(queryType?.fields?.some((f) => f.name === "ping")).toBe(true);
    } finally {
      await unlink(sdlPath);
    }
  });

  it("throws when SDL file has syntax errors", async () => {
    const { writeFile, unlink } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const sdlPath = join(tmpdir(), `test-bad-schema-${Date.now()}.graphql`);
    await writeFile(sdlPath, "this is not valid SDL !!!", "utf-8");

    try {
      await expect(loadGraphQLSchema(sdlPath)).rejects.toThrow("Failed to parse GraphQL SDL");
    } finally {
      await unlink(sdlPath);
    }
  });
});

describe("INTROSPECTION_QUERY", () => {
  it("contains __schema and required fields", () => {
    expect(INTROSPECTION_QUERY).toContain("__schema");
    expect(INTROSPECTION_QUERY).toContain("queryType");
    expect(INTROSPECTION_QUERY).toContain("mutationType");
    expect(INTROSPECTION_QUERY).toContain("TypeRef");
  });
});

// ─── graphqlTypeToJsonSchema — OBJECT in input position ───────────────────────

describe("graphqlTypeToJsonSchema — OBJECT/INTERFACE in input position", () => {
  it("returns string fallback for OBJECT type in input position", () => {
    // OBJECT in an input position is technically invalid GraphQL, but we handle it gracefully
    const typeMap = new Map(
      simpleSchema.types.filter((t) => t.name).map((t) => [t.name!, t])
    );
    const result = graphqlTypeToJsonSchema(
      { kind: "OBJECT", name: "User", ofType: null },
      typeMap
    );
    expect(result).toEqual({ type: "string" });
  });
});

// ─── buildSelectionSet — non-OBJECT/non-UNION type fallback ──────────────────

describe("buildSelectionSet — INPUT_OBJECT return type fallback", () => {
  it("returns empty string for INPUT_OBJECT return type (invalid but defensive)", () => {
    const types: IntrospectionType[] = [
      { kind: "INPUT_OBJECT", name: "SomeInput", inputFields: [] },
    ];
    const typeMap = new Map(types.map((t) => [t.name!, t]));
    const result = buildSelectionSet(
      { kind: "INPUT_OBJECT", name: "SomeInput", ofType: null },
      typeMap
    );
    expect(result).toBe("");
  });
});

// ─── buildSelectionSet — INTERFACE kind ───────────────────────────────────────

describe("buildSelectionSet — INTERFACE kind treated like OBJECT", () => {
  it("recurses into INTERFACE fields at depth 0", () => {
    const types: IntrospectionType[] = [
      {
        kind: "INTERFACE",
        name: "Node",
        fields: [
          { name: "id", description: null, args: [], type: scalar("ID") },
          { name: "name", description: null, args: [], type: scalar("String") },
        ],
      },
    ];
    const typeMap = new Map(types.map((t) => [t.name!, t]));
    const result = buildSelectionSet(
      { kind: "INTERFACE", name: "Node", ofType: null },
      typeMap
    );
    expect(result).toContain("id");
    expect(result).toContain("name");
  });
});

// ─── buildSelectionSet — circular UNION guard ─────────────────────────────────

describe("buildSelectionSet — circular UNION guard", () => {
  it("returns empty string when UNION is already in visited set", () => {
    const types: IntrospectionType[] = [
      {
        kind: "UNION",
        name: "SearchResult",
        possibleTypes: [{ name: "User", kind: "OBJECT" }],
      },
      {
        kind: "OBJECT",
        name: "User",
        fields: [{ name: "id", description: null, args: [], type: scalar("ID") }],
      },
    ];
    const typeMap = new Map(types.map((t) => [t.name!, t]));
    // Pre-seed visited with the UNION name to trigger the guard
    const visited = new Set(["SearchResult"]);
    const result = buildSelectionSet(
      { kind: "UNION", name: "SearchResult", ofType: null },
      typeMap,
      0,
      visited
    );
    expect(result).toBe("");
  });
});

// ─── buildDescription — long description truncation ──────────────────────────

describe("buildGraphQLTools — long description truncated at 200 chars", () => {
  it("truncates field description longer than 200 characters", () => {
    const longDesc = "A".repeat(201);
    const schema: IntrospectionSchema = {
      queryType: { name: "Query" },
      mutationType: null,
      subscriptionType: null,
      types: [
        ...BUILTIN_SCALAR_TYPES,
        {
          kind: "OBJECT",
          name: "Query",
          fields: [
            {
              name: "ping",
              description: longDesc,
              args: [],
              type: scalar("String"),
            },
          ],
        },
      ],
    };
    const tools = buildGraphQLTools(schema);
    const tool = tools.find((t) => t.name === "query_ping")!;
    expect(tool.description.length).toBe(203); // 200 + "..."
    expect(tool.description.endsWith("...")).toBe(true);
  });
});

// ─── buildGraphQLTools — arg without description ──────────────────────────────

describe("buildGraphQLTools — arg without description", () => {
  it("does not include description key for arg with null description", () => {
    const schema: IntrospectionSchema = {
      queryType: { name: "Query" },
      mutationType: null,
      subscriptionType: null,
      types: [
        ...BUILTIN_SCALAR_TYPES,
        {
          kind: "OBJECT",
          name: "Query",
          fields: [
            {
              name: "search",
              description: null,
              args: [
                {
                  name: "term",
                  description: null, // no description
                  type: scalar("String"),
                  defaultValue: null,
                },
              ],
              type: scalar("String"),
            },
          ],
        },
      ],
    };
    const tools = buildGraphQLTools(schema);
    const tool = tools.find((t) => t.name === "query_search")!;
    const termProp = tool.inputSchema.properties["term"] as Record<string, unknown>;
    expect(termProp).not.toHaveProperty("description");
  });

  it("includes description key for arg with a description string", () => {
    const schema: IntrospectionSchema = {
      queryType: { name: "Query" },
      mutationType: null,
      subscriptionType: null,
      types: [
        ...BUILTIN_SCALAR_TYPES,
        {
          kind: "OBJECT",
          name: "Query",
          fields: [
            {
              name: "search",
              description: null,
              args: [
                {
                  name: "term",
                  description: "The search term to filter by",
                  type: scalar("String"),
                  defaultValue: null,
                },
              ],
              type: scalar("String"),
            },
          ],
        },
      ],
    };
    const tools = buildGraphQLTools(schema);
    const tool = tools.find((t) => t.name === "query_search")!;
    const termProp = tool.inputSchema.properties["term"] as Record<string, unknown>;
    expect(termProp).toHaveProperty("description", "The search term to filter by");
  });
});

// ─── buildSelectionSet — OBJECT circular guard ───────────────────────────────

describe("buildSelectionSet — OBJECT circular reference guard (line 172)", () => {
  it("returns empty string when OBJECT is already in visited set", () => {
    const types: IntrospectionType[] = [
      {
        kind: "OBJECT",
        name: "User",
        fields: [{ name: "id", description: null, args: [], type: scalar("ID") }],
      },
    ];
    const typeMap = new Map(types.map((t) => [t.name!, t]));
    const visited = new Set(["User"]);
    const result = buildSelectionSet(
      { kind: "OBJECT", name: "User", ofType: null },
      typeMap,
      0,
      visited
    );
    expect(result).toBe("");
  });
});

// ─── buildSelectionSet — nested INTERFACE field ───────────────────────────────

describe("buildSelectionSet — nested INTERFACE field at depth 0", () => {
  it("recurses into an INTERFACE field in an OBJECT type", () => {
    const types: IntrospectionType[] = [
      {
        kind: "OBJECT",
        name: "Query",
        fields: [
          {
            name: "node",
            description: null,
            args: [],
            type: { kind: "INTERFACE", name: "Node", ofType: null },
          },
        ],
      },
      {
        kind: "INTERFACE",
        name: "Node",
        fields: [
          { name: "id", description: null, args: [], type: scalar("ID") },
        ],
      },
    ];
    const typeMap = new Map(types.map((t) => [t.name!, t]));
    const result = buildSelectionSet(
      { kind: "OBJECT", name: "Query", ofType: null },
      typeMap
    );
    expect(result).toContain("node");
    expect(result).toContain("id");
  });
});

// ─── graphqlTypeToJsonSchema — null enumValues / null inputFields ────────────

describe("graphqlTypeToJsonSchema — null enumValues and null inputFields", () => {
  it("returns empty enum array when type.enumValues is null", () => {
    const types: IntrospectionType[] = [
      { kind: "ENUM", name: "Status", enumValues: null },
    ];
    const typeMap = new Map(types.map((t) => [t.name!, t]));
    const result = graphqlTypeToJsonSchema(
      { kind: "ENUM", name: "Status", ofType: null },
      typeMap
    );
    expect(result).toEqual({ type: "string", enum: [] });
  });

  it("returns empty object schema when INPUT_OBJECT has null inputFields", () => {
    const types: IntrospectionType[] = [
      { kind: "INPUT_OBJECT", name: "EmptyInput", inputFields: null },
    ];
    const typeMap = new Map(types.map((t) => [t.name!, t]));
    const result = graphqlTypeToJsonSchema(
      { kind: "INPUT_OBJECT", name: "EmptyInput", ofType: null },
      typeMap
    );
    expect(result).toMatchObject({ type: "object", properties: {} });
  });
});

// ─── buildGqlTypeString — null name fallback (via buildGraphQLTools) ─────────

describe("buildGraphQLTools — arg with null-named type falls back to String", () => {
  it("uses 'String' when arg type has a null name", () => {
    const schema: IntrospectionSchema = {
      queryType: { name: "Query" },
      mutationType: null,
      subscriptionType: null,
      types: [
        ...BUILTIN_SCALAR_TYPES,
        {
          kind: "OBJECT",
          name: "Query",
          fields: [
            {
              name: "echo",
              description: null,
              args: [
                {
                  name: "val",
                  description: null,
                  type: { kind: "SCALAR", name: null, ofType: null },
                  defaultValue: null,
                },
              ],
              type: scalar("String"),
            },
          ],
        },
      ],
    };
    const tools = buildGraphQLTools(schema);
    const tool = tools.find((t) => t.name === "query_echo")!;
    expect(tool.variableDefinitions[0].gqlType).toBe("String");
  });
});

// ─── buildSelectionSet — edge case: null name, missing type, null fields ──────

describe("buildSelectionSet — defensive edge cases", () => {
  it("returns empty string for anonymous type (null name, non-wrapper kind)", () => {
    // kind is "SCALAR" but name is null — unusual but defensively handled
    const typeMap = new Map<string, IntrospectionType>();
    const result = buildSelectionSet(
      { kind: "SCALAR", name: null, ofType: null },
      typeMap
    );
    expect(result).toBe("");
  });

  it("returns empty string when named type is not in typeMap", () => {
    const typeMap = new Map<string, IntrospectionType>();
    const result = buildSelectionSet(
      { kind: "OBJECT", name: "Ghost", ofType: null },
      typeMap
    );
    expect(result).toBe("");
  });

  it("handles OBJECT type with null fields array gracefully", () => {
    const types: IntrospectionType[] = [
      {
        kind: "OBJECT",
        name: "Empty",
        fields: null, // null fields
      },
    ];
    const typeMap = new Map(types.map((t) => [t.name!, t]));
    const result = buildSelectionSet(
      { kind: "OBJECT", name: "Empty", ofType: null },
      typeMap
    );
    expect(result).toBe("");
  });

  it("handles field whose inner type has null name", () => {
    // field.type is a wrapper type that unwraps to a null-named type
    const types: IntrospectionType[] = [
      {
        kind: "OBJECT",
        name: "Container",
        fields: [
          {
            name: "anon",
            description: null,
            args: [],
            type: { kind: "SCALAR", name: null, ofType: null },
          },
        ],
      },
    ];
    const typeMap = new Map(types.map((t) => [t.name!, t]));
    // innerName will be "" — BUILTIN_SCALARS.has("") is false,
    // typeMap.get("") is undefined → isLeaf = true (via !innerType)
    const result = buildSelectionSet(
      { kind: "OBJECT", name: "Container", ofType: null },
      typeMap
    );
    expect(result).toContain("anon");
  });
});
