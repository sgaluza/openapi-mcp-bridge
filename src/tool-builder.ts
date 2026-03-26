import type {
  OpenAPISpec,
  OpenAPIOperation,
  OpenAPIParameter,
  OpenAPIRequestBody,
  JSONSchema,
} from "./spec-loader.js";
import { isRef, resolveRef, resolveSchemaRefs } from "./spec-loader.js";

export interface ToolDefinition {
  /** MCP tool name derived from operationId or method+path */
  name: string;
  /** Human-readable description from summary/description */
  description: string;
  /** JSON Schema for tool input parameters */
  inputSchema: {
    type: "object";
    properties: Record<string, JSONSchema>;
    required: string[];
  };
  /** HTTP method (uppercase) */
  method: string;
  /** URL path template with {param} placeholders */
  pathTemplate: string;
  /** Names of path parameters */
  pathParams: string[];
  /** Names of query parameters */
  queryParams: string[];
  /** Whether the tool accepts a request body */
  hasBody: boolean;
}

/**
 * Generate a tool name from HTTP method and path when operationId is absent.
 * Example: GET /prs/{id}/issues → get_prs_id_issues
 */
function generateToolName(method: string, path: string): string {
  const cleanPath = path
    .replace(/\{([^}]+)\}/g, "$1")
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return `${method.toLowerCase()}_${cleanPath}`;
}

/**
 * Build a description string from operation summary and description.
 * Truncates description to 200 chars.
 */
function buildDescription(op: OpenAPIOperation): string {
  const parts: string[] = [];
  if (op.summary) parts.push(op.summary);
  if (op.description) {
    const desc =
      op.description.length > 200
        ? op.description.slice(0, 200) + "..."
        : op.description;
    if (desc !== op.summary) parts.push(desc);
  }
  return parts.join(". ") || "No description available";
}

/**
 * Resolve an OpenAPI parameter that might be a $ref.
 */
function resolveParameter(
  spec: OpenAPISpec,
  param: OpenAPIParameter | { $ref: string }
): OpenAPIParameter {
  if (isRef(param)) {
    return resolveRef<OpenAPIParameter>(spec, param.$ref);
  }
  return param as OpenAPIParameter;
}

/**
 * Resolve an OpenAPI request body that might be a $ref.
 */
function resolveRequestBody(
  spec: OpenAPISpec,
  body: OpenAPIRequestBody | { $ref: string }
): OpenAPIRequestBody {
  if (isRef(body)) {
    return resolveRef<OpenAPIRequestBody>(spec, body.$ref);
  }
  return body as OpenAPIRequestBody;
}

export interface FilterToolsOptions {
  /** When true, only include read-only operations (GET and HEAD for OpenAPI) */
  readonly?: boolean;
  /** Whitelist: only include tools whose names are in this list */
  only?: string[];
  /** Blacklist: exclude tools whose names are in this list */
  exclude?: string[];
}

const READONLY_METHODS = new Set(["GET", "HEAD"]);

/**
 * Collect tool description overrides from environment variables prefixed with API2MCP_OVERRIDE_.
 * The tool name is derived by stripping the prefix: API2MCP_OVERRIDE_getFoo → { getFoo: "..." }.
 */
export function collectEnvOverrides(env: Record<string, string | undefined>): Record<string, string> {
  const prefix = "API2MCP_OVERRIDE_";
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(env)) {
    if (key.startsWith(prefix) && val) {
      result[key.slice(prefix.length)] = val;
    }
  }
  return result;
}

/**
 * Override tool descriptions from a name→description map.
 * Only the description field is replaced; all other tool properties are preserved.
 * Returns the original array unchanged when overrides is empty (performance optimisation).
 */
export function applyOverrides(
  tools: ToolDefinition[],
  overrides: Record<string, string>
): ToolDefinition[] {
  if (Object.keys(overrides).length === 0) return tools;

  return tools.map((tool) =>
    tool.name in overrides
      ? { ...tool, description: overrides[tool.name] }
      : tool
  );
}

/**
 * Remove pre-bound parameters from tool input schemas.
 * Bound params are hidden from the MCP client — the bridge injects their
 * values automatically at call time via the bindings map.
 * Applies to path params, query params, and top-level properties.
 *
 * Returns the original array unchanged when bindings is empty
 * (performance optimisation — avoids unnecessary allocation).
 */
export function applyBindings(
  tools: ToolDefinition[],
  bindings: Record<string, string>
): ToolDefinition[] {
  if (Object.keys(bindings).length === 0) return tools;

  return tools.map((tool) => {
    const properties = { ...tool.inputSchema.properties };
    for (const key of Object.keys(bindings)) {
      delete properties[key];
    }

    return {
      ...tool,
      inputSchema: {
        ...tool.inputSchema,
        properties,
        required: tool.inputSchema.required.filter((r) => !(r in bindings)),
      },
      pathParams: tool.pathParams.filter((p) => !(p in bindings)),
      queryParams: tool.queryParams.filter((p) => !(p in bindings)),
    };
  });
}

/**
 * Filter tool definitions based on provided options.
 * Filters are applied in order: readonly → only → exclude.
 * Empty only/exclude arrays are treated as "no filter".
 */
export function filterTools(
  tools: ToolDefinition[],
  options: FilterToolsOptions
): ToolDefinition[] {
  let result = tools;

  if (options.readonly) {
    result = result.filter((t) => READONLY_METHODS.has(t.method));
  }

  if (options.only && options.only.length > 0) {
    const onlySet = new Set(options.only);
    result = result.filter((t) => onlySet.has(t.name));
  }

  if (options.exclude && options.exclude.length > 0) {
    const excludeSet = new Set(options.exclude);
    result = result.filter((t) => !excludeSet.has(t.name));
  }

  return result;
}

/**
 * Convert all OpenAPI operations into MCP tool definitions.
 */
export function buildTools(spec: OpenAPISpec): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  // Shared cache so each $ref component schema is resolved only once across all operations
  const schemaCache = new Map<string, JSONSchema>();

  for (const [path, methods] of Object.entries(spec.paths)) {
    // Skip path-level parameters and other non-method keys
    const httpMethods = [
      "get",
      "post",
      "put",
      "patch",
      "delete",
      "head",
      "options",
    ];

    for (const method of httpMethods) {
      const operation = methods[method] as OpenAPIOperation | undefined;
      if (!operation) continue;

      const name = operation.operationId || generateToolName(method, path);
      const description = buildDescription(operation);

      const properties: Record<string, JSONSchema> = {};
      const required: string[] = [];
      const pathParams: string[] = [];
      const queryParams: string[] = [];

      // Process parameters (path, query, header)
      if (operation.parameters) {
        for (const rawParam of operation.parameters) {
          const param = resolveParameter(spec, rawParam);

          if (param.in === "path" || param.in === "query") {
            const schema = param.schema
              ? resolveSchemaRefs(spec, param.schema, schemaCache)
              : { type: "string" };

            properties[param.name] = {
              ...schema,
              ...(param.description ? { description: param.description } : {}),
            };

            if (param.in === "path") {
              pathParams.push(param.name);
              required.push(param.name);
            } else {
              queryParams.push(param.name);
              if (param.required) {
                required.push(param.name);
              }
            }
          }
        }
      }

      // Process request body
      let hasBody = false;
      if (operation.requestBody) {
        const body = resolveRequestBody(spec, operation.requestBody);
        const content = body.content;
        const jsonContent =
          content?.["application/json"] || content?.["*/*"];

        if (jsonContent?.schema) {
          const bodySchema = resolveSchemaRefs(spec, jsonContent.schema, schemaCache);
          properties["body"] = {
            ...bodySchema,
            ...(body.description ? { description: body.description } : {}),
          };
          if (body.required) {
            required.push("body");
          }
          hasBody = true;
        }
      }

      tools.push({
        name,
        description,
        inputSchema: {
          type: "object",
          properties,
          required,
        },
        method: method.toUpperCase(),
        pathTemplate: path,
        pathParams,
        queryParams,
        hasBody,
      });
    }
  }

  return tools;
}
