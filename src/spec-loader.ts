import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";

export interface OpenAPISpec {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: Array<{ url: string; description?: string }>;
  paths: Record<string, Record<string, OpenAPIOperation>>;
  components?: {
    schemas?: Record<string, JSONSchema>;
    parameters?: Record<string, OpenAPIParameter>;
    requestBodies?: Record<string, OpenAPIRequestBody>;
    securitySchemes?: Record<string, SecurityScheme>;
  };
  security?: Array<Record<string, string[]>>;
}

export interface OpenAPIOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Array<OpenAPIParameter | RefObject>;
  requestBody?: OpenAPIRequestBody | RefObject;
  responses?: Record<string, unknown>;
  security?: Array<Record<string, string[]>>;
  tags?: string[];
}

export interface OpenAPIParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: JSONSchema;
}

export interface OpenAPIRequestBody {
  description?: string;
  required?: boolean;
  content?: Record<string, { schema?: JSONSchema }>;
}

export interface SecurityScheme {
  type: "apiKey" | "http" | "oauth2" | "openIdConnect";
  name?: string;
  in?: "query" | "header" | "cookie";
  scheme?: string;
  bearerFormat?: string;
}

export interface RefObject {
  $ref: string;
}

export type JSONSchema = Record<string, unknown>;

/**
 * Check if an object is a $ref pointer.
 */
export function isRef(obj: unknown): obj is RefObject {
  return typeof obj === "object" && obj !== null && "$ref" in obj;
}

/**
 * Resolve a JSON $ref pointer within the spec (supports #/components/...).
 * Returns the dereferenced object or throws if not found.
 */
export function resolveRef<T>(spec: OpenAPISpec, ref: string): T {
  if (!ref.startsWith("#/")) {
    throw new Error(`External $ref not supported: ${ref}`);
  }
  const parts = ref.slice(2).split("/");
  let current: unknown = spec;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) {
      throw new Error(`Cannot resolve $ref: ${ref}`);
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (current === undefined) {
    throw new Error(`$ref not found: ${ref}`);
  }
  return current as T;
}

/**
 * Recursively resolve all $ref pointers in a JSON Schema object.
 * Handles circular references by tracking visited refs.
 */
export function resolveSchemaRefs(
  spec: OpenAPISpec,
  schema: JSONSchema,
  visited = new Set<string>()
): JSONSchema {
  if (isRef(schema)) {
    const ref = (schema as RefObject).$ref;
    if (visited.has(ref)) {
      return { description: `Circular reference: ${ref}` };
    }
    visited.add(ref);
    const resolved = resolveRef<JSONSchema>(spec, ref);
    return resolveSchemaRefs(spec, resolved, visited);
  }

  const result: JSONSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "properties" && typeof value === "object" && value !== null) {
      const props: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(
        value as Record<string, JSONSchema>
      )) {
        props[propName] = resolveSchemaRefs(spec, propSchema, new Set(visited));
      }
      result[key] = props;
    } else if (key === "items" && typeof value === "object" && value !== null) {
      result[key] = resolveSchemaRefs(
        spec,
        value as JSONSchema,
        new Set(visited)
      );
    } else if (
      key === "allOf" ||
      key === "oneOf" ||
      key === "anyOf"
    ) {
      if (Array.isArray(value)) {
        result[key] = value.map((item: JSONSchema) =>
          resolveSchemaRefs(spec, item, new Set(visited))
        );
      }
    } else if (
      key === "additionalProperties" &&
      typeof value === "object" &&
      value !== null
    ) {
      result[key] = resolveSchemaRefs(
        spec,
        value as JSONSchema,
        new Set(visited)
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Parse raw text as JSON or YAML depending on content.
 */
function parseContent(text: string, hint?: string): unknown {
  if (hint === "json" || text.trimStart().startsWith("{")) {
    return JSON.parse(text);
  }
  return parseYaml(text);
}

/**
 * Determine format hint from URL/path extension or content-type header.
 */
function formatHint(
  source: string,
  contentType?: string | null
): string | undefined {
  if (contentType?.includes("json")) return "json";
  if (contentType?.includes("yaml") || contentType?.includes("yml"))
    return "yaml";
  if (source.endsWith(".json")) return "json";
  if (source.endsWith(".yaml") || source.endsWith(".yml")) return "yaml";
  return undefined;
}

/**
 * Load an OpenAPI spec from a URL or local file path.
 * Supports both JSON and YAML formats.
 */
export async function loadSpec(source: string): Promise<OpenAPISpec> {
  let text: string;
  let hint: string | undefined;

  if (source.startsWith("http://") || source.startsWith("https://")) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch spec from ${source}: ${response.status} ${response.statusText}`
      );
    }
    text = await response.text();
    hint = formatHint(source, response.headers.get("content-type"));
  } else {
    text = await readFile(source, "utf-8");
    hint = formatHint(source);
  }

  const parsed = parseContent(text, hint) as OpenAPISpec;

  if (!parsed.openapi || !parsed.paths) {
    throw new Error(
      "Invalid OpenAPI spec: missing 'openapi' or 'paths' field"
    );
  }

  return parsed;
}
