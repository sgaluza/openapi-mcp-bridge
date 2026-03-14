import type { OpenAPISpec, SecurityScheme } from "./spec-loader.js";

export interface AuthConfig {
  /** Headers passed via --header CLI flags */
  cliHeaders: Record<string, string>;
  /** Environment variables available for auth resolution */
  env: Record<string, string | undefined>;
}

/**
 * Resolve authentication headers from CLI flags, environment variables,
 * and the OpenAPI spec's securitySchemes.
 *
 * Priority:
 * 1. Explicit --header flags (highest priority)
 * 2. OPENAPI_BEARER_TOKEN env → Authorization: Bearer {token}
 * 3. OPENAPI_API_KEY env → uses securitySchemes to determine header name and location
 */
export function resolveAuthHeaders(
  spec: OpenAPISpec,
  config: AuthConfig
): Record<string, string> {
  const headers: Record<string, string> = {};

  // 1. OPENAPI_BEARER_TOKEN from env
  const bearerToken = config.env.OPENAPI_BEARER_TOKEN;
  if (bearerToken) {
    headers["Authorization"] = `Bearer ${bearerToken}`;
  }

  // 2. OPENAPI_API_KEY from env — find matching securityScheme
  const apiKey = config.env.OPENAPI_API_KEY;
  if (apiKey && spec.components?.securitySchemes) {
    const scheme = findApiKeyScheme(spec.components.securitySchemes);
    if (scheme && scheme.in === "header" && scheme.name) {
      headers[scheme.name] = apiKey;
    } else if (scheme && scheme.in === "query") {
      // Query params handled at request time, not as headers.
      // Store as a special marker for the executor.
      headers[`__query:${scheme.name}`] = apiKey;
    } else {
      // Fallback: use common header names
      headers["X-API-Key"] = apiKey;
    }
  }

  // 3. CLI headers override everything
  Object.assign(headers, config.cliHeaders);

  return headers;
}

/**
 * Find the first apiKey-type security scheme in the spec.
 */
function findApiKeyScheme(
  schemes: Record<string, SecurityScheme>
): SecurityScheme | undefined {
  for (const scheme of Object.values(schemes)) {
    if (scheme.type === "apiKey") {
      return scheme;
    }
  }
  return undefined;
}

/**
 * Parse --header "Name: Value" strings into a key-value map.
 */
export function parseHeaderFlags(headers: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const header of headers) {
    const colonIdx = header.indexOf(":");
    if (colonIdx === -1) {
      throw new Error(`Invalid header format: "${header}". Expected "Name: Value".`);
    }
    const name = header.slice(0, colonIdx).trim();
    const value = header.slice(colonIdx + 1).trim();
    result[name] = value;
  }
  return result;
}
