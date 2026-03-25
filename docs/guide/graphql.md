# GraphQL

`api-to-mcp` supports GraphQL APIs — it auto-introspects the schema and turns every query and mutation into an MCP tool.

## Quick start

```bash
# Auto-introspect schema from an endpoint
npx @sgaluza/api-to-mcp graphql https://api.example.com/graphql

# Load from a local SDL file
npx @sgaluza/api-to-mcp graphql ./schema.graphql

# With authentication
npx @sgaluza/api-to-mcp graphql https://api.example.com/graphql \
  -H "Authorization: Bearer eyJhbG..."
```

## Schema → MCP mapping

| GraphQL | MCP tool |
|---------|----------|
| Query name | Tool name |
| Mutation name | Tool name (marked `[MUTATION]`) |
| Description from schema | Tool description |
| Arguments | Input parameters |
| Return type | Included in description |

## Authentication

Same as REST — use env vars, `--header` flags, or a config file:

```bash
# Bearer token
API2MCP_BEARER_TOKEN=eyJhbG... npx @sgaluza/api-to-mcp graphql ./schema.graphql

# Raw Authorization header (e.g. Linear)
API2MCP_AUTH_TOKEN=lin_api_xxx npx @sgaluza/api-to-mcp graphql https://api.linear.app/graphql
```

## Filtering

```bash
# Queries only (no mutations)
npx @sgaluza/api-to-mcp graphql ./schema.graphql --readonly

# Whitelist specific operations
npx @sgaluza/api-to-mcp graphql ./schema.graphql \
  --only "getIssue,listIssues,createIssue"

# Blacklist operations
npx @sgaluza/api-to-mcp graphql ./schema.graphql \
  --exclude "deleteIssue,purgeData"
```

## Config file

```yaml
# api-to-mcp.yml
spec: https://api.example.com/graphql

auth:
  token: lin_api_xxx

options:
  readonly: true
  only:
    - issues
    - issue
    - createIssue
  bind:
    teamId: TEAM_ABC
```

## MCP client config

```json
{
  "mcpServers": {
    "my-graphql-api": {
      "command": "npx",
      "args": [
        "-y", "@sgaluza/api-to-mcp", "graphql",
        "https://api.example.com/graphql"
      ],
      "env": {
        "API2MCP_BEARER_TOKEN": "eyJhbG..."
      }
    }
  }
}
```

## Available flags

```
Options:
  -H, --header <header>       Add a request header (repeatable)
  --readonly                  Expose only Query operations (no Mutations)
  --only <operations>         Whitelist operations by name (comma-separated)
  --exclude <operations>      Blacklist operations by name (comma-separated)
  --bind <binding>            Pre-bind a parameter: key=value (repeatable)
  --config <path>             Path to config file
  -h, --help                  Show help
```
