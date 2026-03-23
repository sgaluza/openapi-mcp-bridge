import { readFile } from "node:fs/promises";

export type TypeKind =
  | "SCALAR"
  | "OBJECT"
  | "INTERFACE"
  | "UNION"
  | "ENUM"
  | "INPUT_OBJECT"
  | "LIST"
  | "NON_NULL";

export interface IntrospectionSchema {
  queryType: { name: string } | null;
  mutationType: { name: string } | null;
  subscriptionType: { name: string } | null;
  types: IntrospectionType[];
}

export interface IntrospectionType {
  kind: TypeKind;
  name: string | null;
  description?: string | null;
  fields?: IntrospectionField[] | null;
  inputFields?: IntrospectionInputValue[] | null;
  enumValues?: Array<{ name: string }> | null;
  possibleTypes?: Array<{ name: string; kind: string }> | null;
}

export interface IntrospectionField {
  name: string;
  description?: string | null;
  args: IntrospectionInputValue[];
  type: IntrospectionTypeRef;
}

export interface IntrospectionInputValue {
  name: string;
  description?: string | null;
  type: IntrospectionTypeRef;
  defaultValue?: string | null;
}

export interface IntrospectionTypeRef {
  kind: TypeKind | string;
  name: string | null;
  ofType: IntrospectionTypeRef | null;
}

export const INTROSPECTION_QUERY = `
  query IntrospectionQuery {
    __schema {
      queryType { name }
      mutationType { name }
      subscriptionType { name }
      types {
        kind
        name
        description
        fields(includeDeprecated: false) {
          name
          description
          args {
            name
            description
            type { ...TypeRef }
            defaultValue
          }
          type { ...TypeRef }
        }
        inputFields {
          name
          description
          type { ...TypeRef }
          defaultValue
        }
        enumValues(includeDeprecated: false) {
          name
        }
        possibleTypes {
          name
          kind
        }
      }
    }
  }
  fragment TypeRef on __Type {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
            }
          }
        }
      }
    }
  }
`.trim();

/**
 * Load a GraphQL schema from a URL (via introspection query) or a local SDL file.
 *
 * @param endpoint - HTTP(S) GraphQL endpoint URL or path to a .graphql SDL file
 * @param headers - Auth and custom headers sent with the introspection request
 * @returns Normalised introspection schema
 */
export async function loadGraphQLSchema(
  endpoint: string,
  headers: Record<string, string> = {}
): Promise<IntrospectionSchema> {
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    return fetchIntrospection(endpoint, headers);
  }
  return loadSDLFile(endpoint);
}

async function fetchIntrospection(
  endpoint: string,
  headers: Record<string, string>
): Promise<IntrospectionSchema> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...headers,
    },
    body: JSON.stringify({ query: INTROSPECTION_QUERY }),
  });

  if (!response.ok) {
    throw new Error(
      `GraphQL introspection failed: ${response.status} ${response.statusText}`
    );
  }

  const result = (await response.json()) as {
    data?: { __schema: IntrospectionSchema };
    errors?: unknown[];
  };

  if (result.errors?.length) {
    throw new Error(
      `GraphQL introspection errors: ${JSON.stringify(result.errors)}`
    );
  }

  if (!result.data?.__schema) {
    throw new Error("Invalid introspection response: missing __schema");
  }

  return result.data.__schema;
}

/**
 * Load schema from a local SDL file by parsing it and running introspection on it.
 * Requires the `graphql` npm package (dynamically imported).
 */
async function loadSDLFile(filePath: string): Promise<IntrospectionSchema> {
  const sdlText = await readFile(filePath, "utf-8");

  const { buildSchema, graphqlSync, getIntrospectionQuery } = await import(
    "graphql"
  );

  let schema;
  try {
    schema = buildSchema(sdlText);
  } catch (error) {
    throw new Error(
      `Failed to parse GraphQL SDL file "${filePath}": ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }

  const result = graphqlSync({ schema, source: getIntrospectionQuery() });

  if (result.errors?.length) {
    throw new Error(
      `GraphQL introspection failed for SDL file "${filePath}": ${JSON.stringify(result.errors)}`
    );
  }

  if (!result.data?.__schema) {
    throw new Error(
      `Invalid introspection result from SDL file "${filePath}": missing __schema`
    );
  }

  return result.data.__schema as IntrospectionSchema;
}
