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
  /** When true, only include read-only operations (GET for OpenAPI) */
  readonly?: boolean;
}

const READONLY_METHODS = new Set(["GET", "HEAD"]);

/**
 * Filter tool definitions based on provided options.
 */
export function filterTools(
  tools: ToolDefinition[],
  options: FilterToolsOptions
): ToolDefinition[] {
  if (options.readonly) {
    return tools.filter((t) => READONLY_METHODS.has(t.method));
  }
  return tools;
}

/**
 * Convert all OpenAPI operations into MCP tool definitions.
 */
export function buildTools(spec: OpenAPISpec): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

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
              ? resolveSchemaRefs(spec, param.schema)
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
          const bodySchema = resolveSchemaRefs(spec, jsonContent.schema);
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
