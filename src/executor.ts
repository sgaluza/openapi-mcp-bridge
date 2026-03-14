import type { ToolDefinition } from "./tool-builder.js";

/**
 * Build and execute an HTTP request based on a tool definition and provided arguments.
 *
 * @param tool - The tool definition with method, path template, and param metadata
 * @param args - The arguments provided by the MCP client
 * @param baseUrl - The base URL from the OpenAPI spec's servers[0].url
 * @param authHeaders - Pre-resolved authentication headers
 * @returns The response body as a string
 */
export async function executeToolCall(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  baseUrl: string,
  authHeaders: Record<string, string>
): Promise<{ content: string; isError: boolean }> {
  // Build the URL path by substituting path parameters
  let path = tool.pathTemplate;
  for (const param of tool.pathParams) {
    const value = args[param];
    if (value === undefined) {
      return {
        content: `Missing required path parameter: ${param}`,
        isError: true,
      };
    }
    path = path.replace(`{${param}}`, encodeURIComponent(String(value)));
  }

  // Build query string from query parameters
  const queryParts: string[] = [];
  for (const param of tool.queryParams) {
    const value = args[param];
    if (value !== undefined && value !== null) {
      queryParts.push(
        `${encodeURIComponent(param)}=${encodeURIComponent(String(value))}`
      );
    }
  }

  // Add query-based auth params (from __query: markers in authHeaders)
  const requestHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(authHeaders)) {
    if (key.startsWith("__query:")) {
      const paramName = key.slice("__query:".length);
      queryParts.push(
        `${encodeURIComponent(paramName)}=${encodeURIComponent(value)}`
      );
    } else {
      requestHeaders[key] = value;
    }
  }

  // Construct the full URL
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const queryString = queryParts.length > 0 ? `?${queryParts.join("&")}` : "";
  const url = `${normalizedBase}${path}${queryString}`;

  // Build the fetch options
  const fetchOptions: RequestInit = {
    method: tool.method,
    headers: {
      ...requestHeaders,
    },
  };

  // Add request body if present
  if (tool.hasBody && args.body !== undefined) {
    (fetchOptions.headers as Record<string, string>)["Content-Type"] =
      "application/json";
    fetchOptions.body = JSON.stringify(args.body);
  }

  try {
    const response = await fetch(url, fetchOptions);
    const responseText = await response.text();

    if (!response.ok) {
      return {
        content: `HTTP ${response.status} ${response.statusText}\n\n${responseText}`,
        isError: true,
      };
    }

    // Try to format JSON response for readability
    try {
      const json = JSON.parse(responseText);
      return { content: JSON.stringify(json, null, 2), isError: false };
    } catch {
      return { content: responseText, isError: false };
    }
  } catch (error) {
    return {
      content: `Request failed: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
}

/**
 * Determine the base URL from the OpenAPI spec and the source URL.
 * If servers[0].url is relative, resolve it against the spec source URL.
 */
export function resolveBaseUrl(
  serversUrl: string | undefined,
  specSource: string
): string {
  if (!serversUrl) {
    // No servers specified — derive from spec source
    if (specSource.startsWith("http://") || specSource.startsWith("https://")) {
      const url = new URL(specSource);
      return `${url.protocol}//${url.host}`;
    }
    return "http://localhost";
  }

  // Absolute URL — use as-is
  if (serversUrl.startsWith("http://") || serversUrl.startsWith("https://")) {
    return serversUrl.replace(/\/$/, "");
  }

  // Relative URL — resolve against spec source
  if (specSource.startsWith("http://") || specSource.startsWith("https://")) {
    const base = new URL(specSource);
    const resolved = new URL(serversUrl, `${base.protocol}//${base.host}`);
    return resolved.toString().replace(/\/$/, "");
  }

  // Local file with relative server URL — assume localhost
  return `http://localhost${serversUrl.startsWith("/") ? "" : "/"}${serversUrl}`.replace(
    /\/$/,
    ""
  );
}
