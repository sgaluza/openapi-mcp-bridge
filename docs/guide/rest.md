# REST / OpenAPI

## Quick start

```bash
# Remote spec
npx @sgaluza/api-to-mcp rest https://api.example.com/openapi.yaml

# Local file
npx @sgaluza/api-to-mcp rest ./openapi.yaml

# Spec via environment variable
API2MCP_SPEC_URL=https://api.example.com/openapi.yaml npx @sgaluza/api-to-mcp rest
```

## Tool naming

Every `operationId` in your spec becomes an MCP tool name. If an operation has no `operationId`, a name is generated from the HTTP method and path:

| OpenAPI | MCP tool name |
|---------|---------------|
| `operationId: getUser` | `getUser` |
| `GET /users/{id}` (no operationId) | `get_users_id` |
| `POST /issues` (no operationId) | `post_issues` |

## OpenAPI → MCP mapping

| OpenAPI field | MCP tool field |
|---------------|----------------|
| `operationId` | Tool name |
| `summary` + `description` | Tool description |
| Path params `{id}` | Required input parameters |
| Query params | Optional input parameters |
| `requestBody` (application/json) | `body` parameter |
| `servers[0].url` | Base URL for all requests (overridable via `--base-url`) |

## Request execution

When an AI calls a tool, the bridge:

1. Substitutes path parameters into the URL template
2. Appends query parameters to the URL
3. Serialises `body` as JSON (POST / PUT / PATCH)
4. Injects pre-bound values and auth headers
5. Returns the HTTP response body as the tool result

## Available flags

```
Options:
  -H, --header <header>       Add a request header (repeatable)
  --base-url <url>            Override base URL from spec's servers[0].url
  --readonly                  Expose only GET and HEAD operations
  --only <operations>         Whitelist operations by name (comma-separated)
  --exclude <operations>      Blacklist operations by name (comma-separated)
  --bind <binding>            Pre-bind a parameter: key=value (repeatable)
  --config <path>             Path to config file (default: auto-discover)
  --auth-type <type>          Auth type (jwt-password)
  --auth-login-url <url>      JWT login endpoint URL
  --auth-token-path <path>    Path to JWT in login response (default: token)
  --auth-refresh-url <url>    JWT refresh endpoint URL
  -h, --help                  Show help
```

## See also

- [Authentication](/guide/auth)
- [Config File](/guide/config-file)
- [Filtering Tools](/guide/filtering)
- [Parameter Binding](/guide/binding)
