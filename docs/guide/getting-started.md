# Getting Started

`api-to-mcp` turns any OpenAPI or GraphQL API into an [MCP](https://modelcontextprotocol.io) server via stdio — so you can connect it to Claude, Cursor, or any MCP-compatible client without writing any code.

## How it works

```
OpenAPI spec / GraphQL schema
        │
        ▼
  api-to-mcp (stdio bridge)
        │
        ├── tool: getUser
        ├── tool: listIssues
        ├── tool: createIssue
        └── ...
        │
        ▼
  Claude / Cursor / any MCP client
```

Each operation in your spec becomes an MCP tool. When an AI calls the tool, `api-to-mcp` makes the real HTTP request and returns the result.

## Installation

No installation required — use `npx`:

```bash
npx @sgaluza/api-to-mcp rest https://api.example.com/openapi.yaml
```

Or install globally:

```bash
npm install -g @sgaluza/api-to-mcp
api-to-mcp rest https://api.example.com/openapi.yaml
```

## Requirements

- Node.js 18 or later

## First steps

### REST / OpenAPI

```bash
# From a remote URL
npx @sgaluza/api-to-mcp rest https://api.example.com/openapi.yaml

# From a local file
npx @sgaluza/api-to-mcp rest ./openapi.yaml

# With authentication
npx @sgaluza/api-to-mcp rest ./openapi.yaml \
  -H "Authorization: Bearer eyJhbG..."
```

### GraphQL

```bash
# Auto-introspect schema from an endpoint
npx @sgaluza/api-to-mcp graphql https://api.example.com/graphql

# From a local SDL file
npx @sgaluza/api-to-mcp graphql ./schema.graphql
```

## Add to your MCP client

Once you confirm the server starts, add it to your MCP client config:

```json
{
  "mcpServers": {
    "my-api": {
      "command": "npx",
      "args": ["-y", "@sgaluza/api-to-mcp", "rest", "https://api.example.com/openapi.yaml"],
      "env": {
        "API2MCP_API_KEY": "your-api-key"
      }
    }
  }
}
```

→ Continue to [REST guide](/guide/rest) or [GraphQL guide](/guide/graphql)
