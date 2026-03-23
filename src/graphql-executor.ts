import type { GraphQLToolDefinition } from "./graphql-tool-builder.js";

/**
 * Build the GraphQL operation string (query or mutation) for a tool.
 * Example output:
 *   query query_getUser($id: ID!) {
 *     getUser(id: $id) { id name email }
 *   }
 */
export function buildGraphQLQuery(tool: GraphQLToolDefinition): string {
  const varDefs = tool.variableDefinitions
    .map((v) => `$${v.name}: ${v.gqlType}`)
    .join(", ");
  const argPassing = tool.variableDefinitions
    .map((v) => `${v.name}: $${v.name}`)
    .join(", ");

  const varDefsStr = varDefs ? `(${varDefs})` : "";
  const argsStr = argPassing ? `(${argPassing})` : "";
  const selectionStr = tool.selectionSet ? ` ${tool.selectionSet}` : "";

  return (
    `${tool.operationType} ${tool.name}${varDefsStr} {\n` +
    `  ${tool.fieldName}${argsStr}${selectionStr}\n` +
    `}`
  );
}

/**
 * Execute a GraphQL operation and return the result as a content string.
 * Sends a POST request with the operation and variables as JSON.
 * Extracts the field data from the response and formats it as pretty JSON.
 *
 * @param tool - The GraphQL tool definition
 * @param args - Arguments provided by the MCP client (may include bound params)
 * @param endpoint - The GraphQL endpoint URL
 * @param headers - Auth and custom headers to include in the request
 */
export async function executeGraphQLCall(
  tool: GraphQLToolDefinition,
  args: Record<string, unknown>,
  endpoint: string,
  headers: Record<string, string>
): Promise<{ content: string; isError: boolean }> {
  const query = buildGraphQLQuery(tool);

  // Build variables map — only include declared variable definitions, not extra args
  const variables: Record<string, unknown> = {};
  for (const v of tool.variableDefinitions) {
    if (args[v.name] !== undefined) {
      variables[v.name] = args[v.name];
    }
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...headers,
      },
      body: JSON.stringify({ query, variables }),
    });

    const responseText = await response.text();

    if (!response.ok) {
      return {
        content: `HTTP ${response.status} ${response.statusText}\n\n${responseText}`,
        isError: true,
      };
    }

    try {
      const json = JSON.parse(responseText) as Record<string, unknown>;

      // Surface GraphQL errors
      if (json.errors) {
        return {
          content: JSON.stringify(json.errors, null, 2),
          isError: true,
        };
      }

      // Extract the specific field data from the response
      const data = (json.data as Record<string, unknown> | undefined)?.[
        tool.fieldName
      ];
      return {
        content: JSON.stringify(data ?? json.data ?? json, null, 2),
        isError: false,
      };
    } catch {
      return { content: responseText, isError: false };
    }
  } catch (error) {
    return {
      content: `Request failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      isError: true,
    };
  }
}
