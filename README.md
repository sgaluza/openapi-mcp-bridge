# api-to-mcp

Turn any API (OpenAPI, GraphQL coming soon) into an MCP server via stdio bridge.

## Usage

```bash
# By URL
npx @sgaluza/api-to-mcp https://api.example.com/openapi.yaml

# Local file
npx @sgaluza/api-to-mcp ./openapi.yaml

# With auth header
npx @sgaluza/api-to-mcp https://api.example.com/openapi.yaml --header "X-API-Key: pk_xxx"

# Multiple headers
npx @sgaluza/api-to-mcp https://api.example.com/openapi.yaml \
  --header "X-API-Key: pk_xxx" \
  --header "X-Custom: value"

# Read-only mode (GET/HEAD only)
npx @sgaluza/api-to-mcp https://api.example.com/openapi.yaml --readonly

# Auth via env (auto-detects from securitySchemes in spec)
API2MCP_API_KEY=pk_xxx npx @sgaluza/api-to-mcp https://api.example.com/openapi.yaml
API2MCP_BEARER_TOKEN=token123 npx @sgaluza/api-to-mcp https://api.example.com/openapi.yaml
```

## Configuration for Claude Code / MetaMCP

```json
{
  "mcpServers": {
    "my-api": {
      "command": "npx",
      "args": ["-y", "@sgaluza/api-to-mcp", "https://api.example.com/openapi.yaml"],
      "env": {
        "API2MCP_API_KEY": "pk_xxx"
      }
    }
  }
}
```

## How it works

Each OpenAPI endpoint becomes an MCP tool:

| OpenAPI | MCP Tool |
|---------|----------|
| `operationId` | Tool name (fallback: `{method}_{path}`) |
| `summary` + `description` | Tool description |
| Path params `{id}` | Required parameters |
| Query params `?page=1` | Optional parameters |
| `requestBody` | `body` parameter (object) |
| `servers[0].url` + path | HTTP request target |

## Auth resolution

1. `--header` flags — added to every request (highest priority)
2. `API2MCP_BEARER_TOKEN` env — `Authorization: Bearer {token}`
3. `API2MCP_API_KEY` env — uses `securitySchemes` from spec to determine header name

Legacy `OPENAPI_BEARER_TOKEN` / `OPENAPI_API_KEY` / `OPENAPI_SPEC_URL` are still supported as aliases.

## License

MIT
