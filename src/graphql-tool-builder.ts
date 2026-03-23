import type {
  IntrospectionSchema,
  IntrospectionType,
  IntrospectionInputValue,
  IntrospectionTypeRef,
} from "./graphql-loader.js";
import type { ToolDefinition } from "./tool-builder.js";
import type { JSONSchema } from "./spec-loader.js";

/**
 * Extended ToolDefinition for GraphQL operations.
 * The base fields (method, pathTemplate, pathParams, queryParams, hasBody)
 * are set to placeholder values — the GraphQL executor uses the GQL-specific fields.
 */
export interface GraphQLToolDefinition extends ToolDefinition {
  /** "query" or "mutation" */
  operationType: "query" | "mutation";
  /** Original GraphQL field name (e.g. "getUser" for tool "query_getUser") */
  fieldName: string;
  /** Ordered list of variables for building the operation string */
  variableDefinitions: Array<{ name: string; gqlType: string }>;
  /** Pre-built selection set string, e.g. "{ id name email }" */
  selectionSet: string;
}

const BUILTIN_SCALARS = new Set(["String", "ID", "Int", "Float", "Boolean"]);

/** Returns true if a type name is a GraphQL introspection type (starts with __). */
function isIntrospectionType(name: string | null): boolean {
  return name !== null && name.startsWith("__");
}

/** Unwrap NON_NULL and LIST wrappers to get the innermost named type reference. */
function unwrapType(typeRef: IntrospectionTypeRef): IntrospectionTypeRef {
  if (typeRef.kind === "NON_NULL" || typeRef.kind === "LIST") {
    return unwrapType(typeRef.ofType!);
  }
  return typeRef;
}

/** Returns true if the type reference is wrapped in NON_NULL (i.e. required). */
function isRequired(typeRef: IntrospectionTypeRef): boolean {
  return typeRef.kind === "NON_NULL";
}

/**
 * Build the GQL type string used in variable declarations.
 * Examples: "ID!" for NON_NULL ID, "[String!]!" for NON_NULL List of NON_NULL String.
 */
function buildGqlTypeString(typeRef: IntrospectionTypeRef): string {
  if (typeRef.kind === "NON_NULL") {
    return `${buildGqlTypeString(typeRef.ofType!)}!`;
  }
  if (typeRef.kind === "LIST") {
    return `[${buildGqlTypeString(typeRef.ofType!)}]`;
  }
  return typeRef.name ?? "String";
}

/**
 * Convert a GraphQL type reference to a JSON Schema object for use in MCP tool input schemas.
 * Handles: scalars, enums, INPUT_OBJECTs (with recursive field mapping), LISTs, NON_NULL.
 *
 * @param typeRef - The type reference to convert
 * @param typeMap - Map of type name → IntrospectionType built from the schema
 * @param visited - Set of type names already being resolved (circular reference guard)
 */
export function graphqlTypeToJsonSchema(
  typeRef: IntrospectionTypeRef,
  typeMap: Map<string, IntrospectionType>,
  visited = new Set<string>()
): JSONSchema {
  // NON_NULL is a modifier — unwrap and convert the inner type
  if (typeRef.kind === "NON_NULL") {
    return graphqlTypeToJsonSchema(typeRef.ofType!, typeMap, visited);
  }

  // LIST → JSON Schema array
  if (typeRef.kind === "LIST") {
    return {
      type: "array",
      items: graphqlTypeToJsonSchema(typeRef.ofType!, typeMap, visited),
    };
  }

  const name = typeRef.name ?? "String";

  // Built-in scalar mapping
  switch (name) {
    case "String":
      return { type: "string" };
    case "ID":
      return { type: "string" };
    case "Int":
      return { type: "integer" };
    case "Float":
      return { type: "number" };
    case "Boolean":
      return { type: "boolean" };
  }

  const type = typeMap.get(name);
  if (!type) return { type: "string" }; // Unknown type — fallback to string

  if (type.kind === "SCALAR") return { type: "string" }; // Custom scalar

  if (type.kind === "ENUM") {
    const values = (type.enumValues ?? []).map((v) => v.name);
    return { type: "string", enum: values };
  }

  if (type.kind === "INPUT_OBJECT") {
    if (visited.has(name)) return { type: "object" }; // Circular reference guard
    visited = new Set(visited);
    visited.add(name);

    const properties: Record<string, JSONSchema> = {};
    const required: string[] = [];

    for (const field of type.inputFields ?? []) {
      properties[field.name] = {
        ...graphqlTypeToJsonSchema(field.type, typeMap, new Set(visited)),
        ...(field.description ? { description: field.description } : {}),
      };
      if (isRequired(field.type)) required.push(field.name);
    }

    return {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }

  return { type: "string" }; // Fallback for OBJECT/INTERFACE in input position
}

/**
 * Build a selection set string for a GraphQL output type.
 * Selects scalar and enum leaf fields at depth 0 and recursively
 * selects scalar/enum fields of nested object types up to depth 1.
 * Returns "" for scalar/enum return types (no selection needed).
 *
 * @param typeRef - The return type reference
 * @param typeMap - Map of type name → IntrospectionType
 * @param depth - Current recursion depth (0 = top-level, max 1)
 * @param visited - Set of type names visited (circular reference guard)
 */
export function buildSelectionSet(
  typeRef: IntrospectionTypeRef,
  typeMap: Map<string, IntrospectionType>,
  depth = 0,
  visited = new Set<string>()
): string {
  // Unwrap wrappers — selection set depends on the named type
  if (typeRef.kind === "NON_NULL" || typeRef.kind === "LIST") {
    return buildSelectionSet(typeRef.ofType!, typeMap, depth, visited);
  }

  const name = typeRef.name;
  if (!name) return "";

  // Builtin scalar or enum → leaf type, no sub-selection
  if (BUILTIN_SCALARS.has(name)) return "";

  const type = typeMap.get(name);
  if (!type) return "";

  if (type.kind === "SCALAR" || type.kind === "ENUM") return "";

  if (type.kind === "OBJECT" || type.kind === "INTERFACE") {
    if (visited.has(name)) return ""; // Circular reference guard
    const nextVisited = new Set(visited);
    nextVisited.add(name);

    const selections: string[] = [];

    for (const field of type.fields ?? []) {
      const inner = unwrapType(field.type);
      const innerName = inner.name ?? "";
      const innerType = typeMap.get(innerName);

      const isLeaf =
        BUILTIN_SCALARS.has(innerName) ||
        !innerType ||
        innerType.kind === "SCALAR" ||
        innerType.kind === "ENUM";

      if (isLeaf) {
        selections.push(field.name);
      } else if (
        depth < 1 &&
        (innerType?.kind === "OBJECT" || innerType?.kind === "INTERFACE")
      ) {
        // Recurse into nested objects at depth 0 only
        const sub = buildSelectionSet(
          field.type,
          typeMap,
          depth + 1,
          new Set(nextVisited)
        );
        if (sub) {
          selections.push(`${field.name} ${sub}`);
        } else {
          // Object type with no selectable fields — include field name as scalar fallback
          selections.push(field.name);
        }
      }
      // depth >= 1: nested objects are skipped (beyond depth limit)
    }

    if (selections.length === 0) return "";
    return `{ ${selections.join(" ")} }`;
  }

  if (type.kind === "UNION" && type.possibleTypes) {
    if (visited.has(name)) return "";
    const nextVisited = new Set(visited);
    nextVisited.add(name);

    const fragments: string[] = ["__typename"];
    for (const pt of type.possibleTypes.slice(0, 3)) {
      const ptRef: IntrospectionTypeRef = {
        kind: "OBJECT",
        name: pt.name,
        ofType: null,
      };
      const sub = buildSelectionSet(ptRef, typeMap, depth, new Set(nextVisited));
      if (sub) fragments.push(`... on ${pt.name} ${sub}`);
    }
    return `{ ${fragments.join(" ")} }`;
  }

  return "";
}

/**
 * Build a human-readable description from a field description.
 * Truncates to 200 characters (consistent with REST tool-builder).
 */
function buildDescription(description: string | null | undefined): string {
  if (!description) return "No description available";
  return description.length > 200 ? description.slice(0, 200) + "..." : description;
}

/**
 * Convert all Query and Mutation fields in the schema into GraphQL MCP tool definitions.
 * Subscriptions are skipped (not applicable to stdio transport).
 *
 * @param schema - The introspection schema
 * @param opts.readonly - When true, only Query operations are included (no Mutations)
 */
export function buildGraphQLTools(
  schema: IntrospectionSchema,
  opts: { readonly?: boolean } = {}
): GraphQLToolDefinition[] {
  // Build type map for fast lookup, excluding introspection meta-types
  const typeMap = new Map<string, IntrospectionType>(
    schema.types
      .filter((t) => t.name !== null && !isIntrospectionType(t.name))
      .map((t) => [t.name!, t])
  );

  const tools: GraphQLToolDefinition[] = [];

  const operationRoots: Array<{
    typeName: string;
    prefix: "query" | "mutation";
  }> = [];

  if (schema.queryType?.name) {
    operationRoots.push({ typeName: schema.queryType.name, prefix: "query" });
  }
  if (!opts.readonly && schema.mutationType?.name) {
    operationRoots.push({
      typeName: schema.mutationType.name,
      prefix: "mutation",
    });
  }

  for (const { typeName, prefix } of operationRoots) {
    const rootType = typeMap.get(typeName);
    if (!rootType?.fields) continue;

    for (const field of rootType.fields) {
      const toolName = `${prefix}_${field.name}`;
      const description = buildDescription(field.description);

      const properties: Record<string, JSONSchema> = {};
      const required: string[] = [];
      const variableDefinitions: Array<{ name: string; gqlType: string }> = [];

      for (const arg of field.args) {
        properties[arg.name] = {
          ...graphqlTypeToJsonSchema(arg.type, typeMap),
          ...(arg.description ? { description: arg.description } : {}),
        };
        if (isRequired(arg.type)) required.push(arg.name);
        variableDefinitions.push({
          name: arg.name,
          gqlType: buildGqlTypeString(arg.type),
        });
      }

      const selectionSet = buildSelectionSet(field.type, typeMap);

      tools.push({
        name: toolName,
        description,
        inputSchema: { type: "object", properties, required },
        method: "POST",
        pathTemplate: "",
        pathParams: [],
        queryParams: [],
        hasBody: false,
        operationType: prefix,
        fieldName: field.name,
        variableDefinitions,
        selectionSet,
      });
    }
  }

  return tools;
}
